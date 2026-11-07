import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Person } from '../model/types';
import { RequestWithUser, USER_HEADER } from './current-user';
import { IS_PUBLIC } from './public.decorator';

/**
 * Stand-in for real auth: trusts the `X-Intellect-User` header (a person id, set by the
 * frontend's role switch) and loads that person. This guard is the only thing real auth replaces.
 */
@Injectable()
export class StubAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ES_CLIENT) private readonly es: Client,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    const raw = req.headers[USER_HEADER];
    const userId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!userId) throw new UnauthorizedException(`Missing ${USER_HEADER} header`);

    const res = await this.es.get<Person>({ index: ALIASES.people, id: userId }, { ignore: [404] });
    if (!res.found || !res._source) throw new UnauthorizedException(`Unknown user ${userId}`);
    req.user = res._source;
    return true;
  }
}
