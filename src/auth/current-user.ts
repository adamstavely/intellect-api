import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Person } from '../model/types';

export const USER_HEADER = 'x-intellect-user';

export type RequestWithUser = Request & { user?: Person };

/** The person the auth guard resolved for this request. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Person => {
  const user = ctx.switchToHttp().getRequest<RequestWithUser>().user;
  if (!user) throw new Error('CurrentUser used on a route without the auth guard');
  return user;
});
