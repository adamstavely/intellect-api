import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { join } from 'node:path';
import type { AuditEvent } from './audit-event';

const APP = join(__dirname, '../../test/unit/audit-sigterm-app.ts');

/** What the app in the child process reported, in order, and what it logged as errors. */
interface Run {
  messages: { committed?: true; write?: AuditEvent[]; close?: true; port?: number }[];
  stderr: string;
  /** From SIGTERM to the process exiting, ms. */
  exitMs: number;
}

/**
 * Starts the app in its own process, POSTs over a real connection, drops the connection once the handler has
 * committed, then sends SIGTERM 100ms later, as Kubernetes would mid-request; resolves once the process has exited.
 */
function commitDisconnectTerminate(env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', APP], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const messages: Run['messages'] = [];
    let stderr = '';
    let out = '';
    let terminatedAt = 0;
    let client: ReturnType<typeof request> | undefined;
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString();
      for (let nl = out.indexOf('\n'); nl >= 0; nl = out.indexOf('\n')) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        const message = JSON.parse(line) as Run['messages'][number];
        messages.push(message);
        if (message.port) {
          const req = request({ port: message.port, host: '127.0.0.1', path: '/things', method: 'POST', agent: false, headers: { 'content-type': 'application/json' } });
          req.on('error', () => undefined);
          req.end('{"name":"x"}');
          client = req;
        }
        if (message.committed) {
          client?.destroy();
          setTimeout(() => {
            terminatedAt = performance.now();
            child.kill('SIGTERM');
          }, 100);
        }
      }
    });
    child.on('error', reject);
    child.on('exit', () => resolve({ messages, stderr, exitMs: performance.now() - terminatedAt }));
  });
}

const written = (run: Run) => run.messages.flatMap((m) => m.write ?? []);
const order = (run: Run) => run.messages.map((m) => (m.write ? 'write' : m.close ? 'close' : m.committed ? 'commit' : 'port'));

describe('audit across SIGTERM, in a real process', () => {
  // Each case is its own process; they start together, since most of each one's time is the app starting.
  let held: Run, stuck: Run, stuckUnwritable: Run;
  beforeAll(async () => {
    [held, stuck, stuckUnwritable] = await Promise.all([
      commitDisconnectTerminate({ HOLD_MS: '1500' }),
      commitDisconnectTerminate({ AUDIT_SHUTDOWN_TIMEOUT_MS: '1000' }),
      commitDisconnectTerminate({ AUDIT_SHUTDOWN_TIMEOUT_MS: '1000', BULK: 'hang' }),
    ]);
  }, 60_000);

  it('records a write committed before the client left and shutdown began, once, before Elasticsearch closes', () => {
    const events = written(held);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'POST /things', outcome: { status: 201, ok: true, delivery: 'aborted' } });
    expect(order(held)).toEqual(['port', 'commit', 'write', 'close']);
    expect(held.stderr).not.toContain('not written');
  });

  it('records a handler still running at the deadline as unresolved, and writes it before Elasticsearch closes', () => {
    const events = written(stuck);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'POST /things', outcome: { status: null, ok: null, delivery: 'unresolved' } });
    expect(order(stuck)).toEqual(['port', 'commit', 'write', 'close']);
    // Within the one shutdown deadline, give or take the process winding down.
    expect(stuck.exitMs).toBeLessThan(2000);
  });

  it('logs that unresolved event in full when it cannot be written by the deadline', () => {
    expect(written(stuckUnwritable)).toEqual([]);
    expect(order(stuckUnwritable)).toEqual(['port', 'commit', 'close']);
    expect(stuckUnwritable.stderr).toMatch(/Audit event \S+ not written \(not confirmed written within the 1000ms shutdown deadline\); event: .*"delivery":"unresolved"/);
    expect(stuckUnwritable.stderr.match(/not written/g)).toHaveLength(1);
    expect(stuckUnwritable.exitMs).toBeLessThan(2000);
  });
});
