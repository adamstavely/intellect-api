import { Controller, Get } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../app-setup';
import { auditOptions, trustProxyOption } from '../config/configuration';
import { ES_CLIENT, ElasticModule } from '../elastic/elastic.module';
import type { AuditEvent } from './audit-event';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';

@Controller('ping')
class PingController {
  @Get()
  ping(): string {
    return 'pong';
  }
}

describe('TRUST_PROXY', () => {
  it('trusts no proxy unless told to', () => {
    expect(trustProxyOption({})).toBe(false);
    expect(trustProxyOption({ TRUST_PROXY: ' ' })).toBe(false);
    expect(trustProxyOption({ TRUST_PROXY: 'false' })).toBe(false);
  });

  it('takes Express’s forms: true, a hop count, or addresses, ranges and names', () => {
    expect(trustProxyOption({ TRUST_PROXY: 'true' })).toBe(true);
    expect(trustProxyOption({ TRUST_PROXY: '2' })).toBe(2);
    expect(trustProxyOption({ TRUST_PROXY: 'loopback, 10.0.0.0/8 ,' })).toEqual(['loopback', '10.0.0.0/8']);
  });
});

describe('the audited client address', () => {
  /** The ip audited for one request from this test (over loopback) claiming to be forwarded for 203.0.113.7. */
  const auditedIp = async (env: NodeJS.ProcessEnv): Promise<string | null> => {
    const record = jest.fn<void, [AuditEvent]>();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ audit: auditOptions({}), elasticsearch: {}, trustProxy: trustProxyOption(env) })] }),
        ElasticModule,
        AuditModule,
      ],
      controllers: [PingController],
    })
      .overrideProvider(ES_CLIENT)
      .useValue({ close: () => Promise.resolve() })
      .overrideProvider(AuditService)
      .useValue({ record })
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app);
    await app.init();
    try {
      await request(app.getHttpServer()).get('/ping').set('X-Forwarded-For', '203.0.113.7').expect(200);
      return record.mock.calls[0][0].ip;
    } finally {
      await app.close();
    }
  };

  it('is whoever connected by default, whatever X-Forwarded-For claims', async () => {
    expect(await auditedIp({})).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
  });

  it('is the forwarded client behind a trusted proxy', async () => {
    expect(await auditedIp({ TRUST_PROXY: 'loopback' })).toBe('203.0.113.7');
    expect(await auditedIp({ TRUST_PROXY: '1' })).toBe('203.0.113.7');
  });

  it('is the proxy when the one connecting isn’t trusted', async () => {
    expect(await auditedIp({ TRUST_PROXY: '10.0.0.0/8' })).not.toBe('203.0.113.7');
  });
});
