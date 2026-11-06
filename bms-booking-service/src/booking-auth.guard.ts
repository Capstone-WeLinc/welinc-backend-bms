import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export type BmsRole = 'ADMIN' | 'CUSTOMER_SUPPORT' | 'OPERATIONS';
const ROLES = 'bmsRoles';
export const BmsRoles = (...roles: BmsRole[]) => SetMetadata(ROLES, roles);

@Injectable()
export class BookingAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new ServiceUnavailableException('Booking authentication is not configured');
    const request = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer (.+)$/i.exec(request.header('authorization') ?? '');
    if (!match) throw new UnauthorizedException();
    let claims: { sub?: string; roles?: Array<{ role: string; system: string }> };
    try {
      claims = await this.jwt.verifyAsync(match[1], { secret, algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException();
    }
    if (!claims?.sub) throw new UnauthorizedException();
    const required = this.reflector.getAllAndOverride<BmsRole[]>(ROLES, [context.getHandler(), context.getClass()]) ?? [];
    const assignments = Array.isArray(claims.roles) ? claims.roles : [];
    if (!required.some((role) => assignments.some((item) => item.system === 'BMS' && item.role === role))) {
      throw new ForbiddenException();
    }
    const matchedRole = required.find((role) => assignments.some((item) => item.system === 'BMS' && item.role === role))
      ?? assignments.find((item) => item.system === 'BMS')?.role as BmsRole | undefined;
    (request as Request & { bmsIdentity?: { sub: string; role?: BmsRole } }).bmsIdentity = { sub: claims.sub, role: matchedRole };
    return true;
  }
}
