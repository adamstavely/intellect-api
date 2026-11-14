import { CanActivate, ConflictException, Controller, INestApplication, Injectable, Logger, Post, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { auditOptions } from '../config/configuration';
import { ElasticModule, ES_CLIENT } from '../elastic/elastic.module';
import type { AuditEvent } from './audit-event';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';

/** A gate the test opens: handlers and guards wait at it, so the client can leave at a chosen moment. */
class Gate {
  #open!: () => void;
  #reached!: () => void;
  readonly opened = new Promise<void>((r) => (this.#open = r));
  readonly reached = new Promise<void>((r) => (this.#reached = r));
  async pass(): Promise<void> {
    this.#reached();
    await this.opened;
  }
  open(): void {
    this.#open();
  }
}

let gate: Gate;
/** What the handlers did, in order: a stand-in for writes to the store. */
const committed: string[] = [];

@Injectable()
class SlowGuard implements CanActivate {
  async canActivate(): Promise<boolean> {
    await gate.pass();
    return true;
  }
}

@Controller('things')
class ThingsController {
  /** Waits, then commits: the client can leave before the write. */
  @Post('commit-later')
  async commitLater(): Promise<{ ok: boolean }> {
    await gate.pass();
    committed.push('commit-later');
    return { ok: true };
  }

  /** Waits, then fails: nothing is written. */
  @Post('fail-later')
  async failLater(): Promise<never> {
    await gate.pass();
    throw new ConflictException('already there');
  }

  /** Commits, then holds the response: the client can leave after the write. */
  @Post('commit-first')
  async commitFirst(): Promise<{ ok: boolean }> {
    committed.push('commit-first');
    await gate.pass();
    return { ok: true };
  }

  /** Behind a guard that waits: the client can leave before the handler starts. */
  @Post('guarded')
  @UseGuards(SlowGuard)
  guarded(): { ok: boolean } {
    committed.push('guarded');
    return { ok: true };
  }
}

describe('audit when the client disconnects, over HTTP', () => {
  let app: INestApplication;
  let port: number;
  const written: AuditEvent[] = [];
  const es = {
    bulk: jest.fn(({ operations }: { operations: AuditEvent[] }) => {
      const events = operations.filter((_, i) => i % 2 === 1);
      written.push(...events);
      return Promise.resolve({ errors: false, items: events.map(() => ({ create: { status: 201 } })) });
    }),
    close: jest.fn(() => Promise.resolve()),
  };

  beforeEach(async () => {
    gate = new Gate();
    committed.length = 0;
    written.length = 0;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ audit: auditOptions({}), elasticsearch: {} })] }),
        ElasticModule,
        AuditModule,
      ],
      controllers: [ThingsController],
      providers: [SlowGuard],
    })
      .overrideProvider(ES_CLIENT)
      .useValue(es)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterEach(async () => {
    gate.open();
    await app.close();
  });

  /** Sends a POST and returns a way to drop the connection, as a client that gives up does. */
  const post = (path: string) => {
    let status: number | undefined;
    const req = request({ port, host: '127.0.0.1', path, method: 'POST', agent: false, headers: { 'content-type': 'application/json' } }, (res) => {
      status = res.statusCode;
      res.resume();
    });
    req.on('error', () => undefined);
    req.end('{"name":"x"}');
    return { disconnect: () => req.destroy(), status: () => status };
  };
  /** Time for the server to see the connection drop. */
  const settle = () => new Promise((r) => setTimeout(r, 50));
  /** Every event audited so far, once any running handler has had time to settle and nothing more is coming. */
  const audited = async (): Promise<AuditEvent[]> => {
    await new Promise((r) => setTimeout(r, 100));
    await app.get(AuditService).flush();
    return written;
  };

  it('records a write committed after the client left, once, as aborted with the handler’s status', async () => {
    const client = post('/things/commit-later');
    await gate.reached;
    client.disconnect();
    await settle();
    // Not yet: the handler is still running, and its outcome isn't known.
    expect(await audited()).toEqual([]);

    gate.open();
    const events = await audited();
    expect(committed).toEqual(['commit-later']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'POST /things/commit-later', outcome: { status: 201, ok: true, delivery: 'aborted' } });
    expect(client.status()).toBeUndefined();
  });

  it('records a write that failed after the client left as aborted with the failure', async () => {
    const client = post('/things/fail-later');
    await gate.reached;
    client.disconnect();
    await settle();
    gate.open();
    const events = await audited();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toEqual({ status: 409, ok: false, delivery: 'aborted' });
  });

  it('records a write committed before the client left, while the response was held, as aborted with the handler’s status', async () => {
    const client = post('/things/commit-first');
    await gate.reached;
    expect(committed).toEqual(['commit-first']);
    client.disconnect();
    await settle();
    gate.open();
    const events = await audited();
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toEqual({ status: 201, ok: true, delivery: 'aborted' });
  });

  it('records a client that left before any handler started as aborted with no status, and runs no handler', async () => {
    const client = post('/things/guarded');
    await gate.reached;
    client.disconnect();
    await settle();
    gate.open();
    const events = await audited();
    expect(committed).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'POST /things/guarded', outcome: { status: null, ok: null, delivery: 'aborted' } });
  });

  it('records a request the client saw through, once, as completed', async () => {
    gate.open();
    const client = post('/things/commit-later');
    const events = await audited();
    expect(client.status()).toBe(201);
    expect(events).toHaveLength(1);
    expect(events[0].outcome).toEqual({ status: 201, ok: true, delivery: 'completed' });
  });

  beforeAll(() => jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());
});
