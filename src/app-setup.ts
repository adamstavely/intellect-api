import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TrustProxy } from './config/configuration';

/** App-level settings that live on Express rather than in a module; main.ts and the integration tests both apply them. */
export function configureApp(app: NestExpressApplication): void {
  // Which proxies to believe about the client's address (req.ip), as the audit trail records it. Off by default.
  app.set('trust proxy', app.get(ConfigService).get<TrustProxy>('trustProxy') ?? false);
}
