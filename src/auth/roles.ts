import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PersonRole } from '../model/types';
import type { RequestWithUser } from './current-user';

export const ROLES = 'intellect:roles';

/** Restricts a route to the given roles; anyone else gets 403. */
export const Roles = (...roles: PersonRole[]) => SetMetadata(ROLES, roles);

/** Runs after StubAuthGuard (it's registered second), so `req.user` is already set. Survives the switch to real auth. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<PersonRole[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles?.length) return true;
    const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    return true;
  }
}
