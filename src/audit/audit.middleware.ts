import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { RequestWithUser, USER_HEADER } from '../auth/current-user';
import { toAuditEvent } from './audit-event';
import { AuditService } from './audit.service';

/** Paths that are infrastructure, not user actions: liveness and readiness probes, and the API docs. */
const SKIP = /^\/(health|docs)(\/|$)/;

/** Audits every API request once its response has gone out, whatever the outcome. */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  readonly #log = new Logger('Audit');

  constructor(private readonly audit: AuditService) {}

  use(req: RequestWithUser, res: Response, next: NextFunction): void {
    const path = (req.originalUrl ?? req.url).split('?')[0];
    if (SKIP.test(path)) return next();
    const startedAt = performance.now();
    const startedWall = Date.now();
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    res.on('finish', () => {
      // The response has gone; a failure here must not take the process down with it.
      try {
        this.#record(req, res, id, path, startedWall, startedAt);
      } catch (err) {
        this.#log.error(`Could not audit request ${id}: ${(err as Error).message}`);
      }
    });
    next();
  }

  #record(req: RequestWithUser, res: Response, id: string, path: string, startedWall: number, startedAt: number): void {
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
        status: res.statusCode,
        startedAt: startedWall,
        finishedAt: startedWall + (performance.now() - startedAt),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
    );
  }
}
