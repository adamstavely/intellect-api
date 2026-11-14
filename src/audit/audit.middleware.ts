import { CallHandler, ExecutionContext, HttpException, Injectable, Logger, NestInterceptor, NestMiddleware } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';
import { RequestWithUser, USER_HEADER } from '../auth/current-user';
import { AuditDelivery, toAuditEvent } from './audit-event';
import { AuditService } from './audit.service';

/** Paths that are infrastructure, not user actions: liveness and readiness probes, and the API docs. */
const SKIP = /^\/(health|docs)(\/|$)/;

/** What the audit trail knows of a request in progress; the middleware and the interceptor share it. */
interface AuditState {
  recorded: boolean;
  /** The client went away before any handler started: none will run now (see AuditInterceptor). */
  abandoned: boolean;
  /** The status the handler returned or threw, once it settles; unset until a handler starts. */
  handler?: Promise<number | null>;
}
const STATE = Symbol('audit');
type AuditedRequest = RequestWithUser & { [STATE]?: AuditState };

/**
 * Audits every API request exactly once, whatever the outcome: when its response has gone out (`completed`), or when
 * the client goes away first (`aborted`). An aborted request is recorded with what its handler did – waiting for it to
 * finish if it's still running, so a write it commits after the client left is still on the trail – or, if no handler
 * had started, with no status at all: a dropped connection alone says nothing about what was or wasn't written.
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  readonly #log = new Logger('Audit');

  constructor(private readonly audit: AuditService) {}

  use(req: AuditedRequest, res: Response, next: NextFunction): void {
    const path = (req.originalUrl ?? req.url).split('?')[0];
    if (SKIP.test(path)) return next();
    const startedAt = performance.now();
    const startedWall = Date.now();
    const id = randomUUID();
    const state: AuditState = { recorded: false, abandoned: false };
    req[STATE] = state;
    res.setHeader('X-Request-Id', id);

    const record = (status: number | null, delivery: AuditDelivery) => {
      if (state.recorded) return;
      state.recorded = true;
      // The response has gone (or the client has); a failure here must not take the process down with it.
      try {
        this.#record(req, id, path, status, delivery, startedWall, startedAt);
      } catch (err) {
        this.#log.error(`Could not audit request ${id}: ${(err as Error).message}`);
      }
    };
    res.on('finish', () => record(res.statusCode, 'completed'));
    // Also emitted after 'finish'; on its own, the connection closed before the response was complete.
    res.on('close', () => {
      if (state.recorded || res.writableFinished) return;
      if (!state.handler) {
        state.abandoned = true;
        record(null, 'aborted');
      } else {
        void state.handler.then((status) => record(status, 'aborted'));
      }
    });
    next();
  }

  #record(req: RequestWithUser, id: string, path: string, status: number | null, delivery: AuditDelivery, startedWall: number, startedAt: number): void {
    const claimed = req.headers[USER_HEADER];
    this.audit.record(
      toAuditEvent({
        id,
        method: req.method,
        route: (req.route as { path?: string } | undefined)?.path,
        path,
        params: (req.params ?? {}) as Record<string, string>,
        query: req.query ?? {},
        body: req.body,
        user: req.user,
        claimedUser: (Array.isArray(claimed) ? claimed[0] : claimed)?.trim() || undefined,
        status,
        delivery,
        startedAt: startedWall,
        finishedAt: startedWall + (performance.now() - startedAt),
        // The client as Express sees it: X-Forwarded-For counts only from proxies TRUST_PROXY trusts (see configureApp).
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
    );
  }
}

/** Nest's status for an exception its default filter handles: the HttpException's own, else 500. */
const statusOf = (err: unknown) => (err instanceof HttpException ? err.getStatus() : 500);

/**
 * Notes, for the audit trail, the status each handler's result comes to – independently of whether the response then
 * reaches the client – so a request whose client went away is still recorded with what it did (see AuditMiddleware).
 * A request whose client left before its handler started isn't run at all: the trail already says it was aborted
 * with no outcome, and that stays true.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuditedRequest>();
    const state = req[STATE];
    if (!state) return next.handle();
    // 499: nginx's "client closed request". Nobody receives it; it only keeps the handler from running.
    if (state.abandoned) throw new HttpException('Client closed request', 499);

    const success = (Reflect.getMetadata(HTTP_CODE_METADATA, ctx.getHandler()) as number | undefined) ?? (req.method === 'POST' ? 201 : 200);
    let settle!: (status: number | null) => void;
    state.handler = new Promise<number | null>((r) => (settle = r));
    return next.handle().pipe(
      tap({
        next: () => settle(success),
        complete: () => settle(success),
        error: (err: unknown) => settle(statusOf(err)),
        // Unsubscribed without a result (shouldn't happen over HTTP): nothing is known, so nothing is claimed.
        unsubscribe: () => settle(null),
      }),
    );
  }
}
