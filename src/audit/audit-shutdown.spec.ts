import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { auditOptions } from '../config/configuration';
import { ElasticModule, ES_CLIENT } from '../elastic/elastic.module';
import type { AuditEvent } from './audit-event';
import { AuditModule } from './audit.module';

/** A request still in flight when shutdown starts: it answers when the test lets it. */
@Controller('slow')
class SlowController {
  static arrived: () => void;
  static release: () => void;

  @Get()
  async get(): Promise<{ ok: boolean }> {
    await new Promise<void>((r) => {
      SlowController.release = r;
      SlowController.arrived();
    });
    return { ok: true };
  }
}

describe('audit on shutdown, in the app', () => {
  let app: INestApplication;
  const order: string[] = [];
  const es = {
    bulk: jest.fn(({ operations }: { operations: AuditEvent[] }) => {
      const events = operations.filter((_, i) => i % 2 === 1);
      order.push(`write ${events.map((e) => e.path).join(',')}`);
      return Promise.resolve({ errors: false, items: events.map(() => ({ create: { status: 201 } })) });
    }),
    close: jest.fn(() => {
      order.push('close');
      return Promise.resolve();
    }),
  };

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ audit: auditOptions({}), elasticsearch: {} })] }),
        ElasticModule,
        AuditModule,
      ],
      controllers: [SlowController],
    })
      .overrideProvider(ES_CLIENT)
      .useValue(es)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.enableShutdownHooks();
    await app.listen(0, '127.0.0.1');
  });
  afterEach(() => jest.restoreAllMocks());

  it('audits a request that finishes during shutdown, and closes Elasticsearch only after writing it', async () => {
    const arrived = new Promise<void>((r) => (SlowController.arrived = r));
    const { port } = app.getHttpServer().address() as AddressInfo;
    // No keep-alive, so the server closes as soon as the request is done.
    const response = new Promise<string>((resolve, reject) =>
      get({ port, host: '127.0.0.1', path: '/slow', agent: false }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve(body));
      }).on('error', reject),
    );
    await arrived;

    const closing = app.close();
    // Let shutdown get as far as it can while the request is still running.
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([]);

    SlowController.release();
    expect(JSON.parse(await response)).toEqual({ ok: true });
    await closing;
    expect(order).toEqual(['write /slow', 'close']);
  });
});
