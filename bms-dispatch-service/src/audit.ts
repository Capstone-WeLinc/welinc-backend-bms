import { CallHandler, Controller, ExecutionContext, Get, Headers, Injectable, NestInterceptor, UnauthorizedException } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { Observable, catchError, concatMap, from, map, of } from 'rxjs';
import { PrismaService } from './prisma.service';
import { describeAction, relabelLegacy } from './audit-actions';
import { AUDIT_RULES } from './audit-rules';

function serviceAuth(key: string | undefined) {
  const expected = process.env.BMS_INTERNAL_SERVICE_KEY;
  if (!expected || expected.length < 32 || !key) throw new UnauthorizedException();
  const supplied = Buffer.from(key);
  const stored = Buffer.from(expected);
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) throw new UnauthorizedException();
}

@Controller('internal/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async list(@Headers('x-bms-service-key') key: string) {
    serviceAuth(key);
    const rows = await this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 });
    return rows.flatMap((row) => relabelLegacy(AUDIT_RULES, row) ?? []);
  }
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method?: string; originalUrl?: string; headers?: Record<string, string>; ip?: string; body?: unknown }>();
    const method = String(request.method ?? '').toUpperCase();
    const path = String(request.originalUrl ?? '').split('?')[0];
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || path.startsWith('/internal/')) return next.handle();
    const token = String(request.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    let claims: { sub?: string; roles?: { system: string; role: string }[] };
    try { claims = this.jwt.verify(token, { secret: process.env.JWT_SECRET, algorithms: ['HS256'] }); }
    catch { return next.handle(); }
    if (!claims.sub || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)) return next.handle();
    const role = claims.roles?.find((item) => item.system === 'BMS')?.role ?? null;
    return next.handle().pipe(concatMap((result) => {
      // Only successful writes reach here; the label is built from the route, the request and the response.
      const action = describeAction(AUDIT_RULES, method, String(request.originalUrl ?? ''), request.body, result);
      if (action === null) return of(result);
      return from(this.prisma.auditEvent.create({ data: {
        actorId: claims.sub!, role, action, path: path.slice(0, 500), ipAddress: request.ip?.slice(0, 45) ?? null,
      } })).pipe(map(() => result), catchError(() => of(result)));
    }));
  }
}

export const AuditProvider = { provide: APP_INTERCEPTOR, useClass: AuditInterceptor };
