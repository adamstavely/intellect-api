/**
 * A child process for src/audit/audit-sigterm.spec.ts: the audit module in a real Nest app with shutdown hooks, over a
 * stand-in for Elasticsearch. It reports on stdout, one JSON line each: its port, the commit, every bulk write's
 * events and the client closing. Set by the test: HOLD_MS (how long the handler holds its result after committing;
 * unset, forever), BULK=hang (writes never answer, only an abort ends them) and AUDIT_SHUTDOWN_TIMEOUT_MS.
 */
import 'reflect-metadata';
import { Controller, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type { AuditEvent } from '../../src/audit/audit-event';
import { AuditModule } from '../../src/audit/audit.module';
import { auditOptions } from '../../src/config/configuration';
import { ElasticModule, ES_CLIENT } from '../../src/elastic/elastic.module';

const say = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);

@Controller('things')
class ThingsController {
  /** Commits, then holds its result: the client can leave, and shutdown begin, after the write. */
  @Post()
  async commit(): Promise<{ ok: boolean }> {
    say({ committed: true });
    const hold = Number(process.env.HOLD_MS);
    await new Promise<void>((r) => hold && setTimeout(r, hold));
    return { ok: true };
  }
}

const es = {
  bulk: ({ operations }: { operations: AuditEvent[] }, { signal }: { signal: AbortSignal }) => {
    const events = operations.filter((_, i) => i % 2 === 1);
    if (process.env.BULK === 'hang') {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Request aborted'))));
    }
    say({ write: events });
    return Promise.resolve({ errors: false, items: events.map(() => ({ create: { status: 201 } })) });
  },
  close: () => {
    say({ close: true });
    return Promise.resolve();
  },
};

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ audit: auditOptions(process.env), elasticsearch: {} })] }),
      ElasticModule,
      AuditModule,
    ],
    controllers: [ThingsController],
  })
    .overrideProvider(ES_CLIENT)
    .useValue(es)
    .compile();
  // Errors only: the audit fallback log is one.
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.enableShutdownHooks();
  await app.listen(0, '127.0.0.1');
  say({ port: (app.getHttpServer().address() as AddressInfo).port });
}

void main();
