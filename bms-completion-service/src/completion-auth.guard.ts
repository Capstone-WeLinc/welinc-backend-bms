import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccountCheck } from './auth/account-check';
import { TOKEN_VERIFIER, TokenVerifier, checkPerson } from './auth/verify';
export type BmsRole = 'ADMIN' | 'CUSTOMER_SUPPORT' | 'OPERATIONS';
const ROLES = 'bmsRoles';
export const BmsRoles = (...roles: BmsRole[]) => SetMetadata(ROLES,roles);
@Injectable()
export class CompletionAuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier, private readonly accounts: AccountCheck, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const {raw,token} = await checkPerson(this.verifier,req);
    const {user} = await this.accounts.confirm(raw,token);
    const required = this.reflector.getAllAndOverride<BmsRole[]>(ROLES,[context.getHandler(),context.getClass()]) ?? [];
    const role = required.find(role => user.roles.some(item => item.system==='BMS' && item.role===role));
    if (!role) throw new ForbiddenException();
    Object.assign(req,{user:{...user,roles:token.roles},bmsIdentity:{...user,role,roles:token.roles}});
    return true;
  }
}
