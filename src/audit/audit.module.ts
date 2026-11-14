import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditForwarder } from './audit-forwarder.service';
import { AuditInterceptor, AuditMiddleware } from './audit.middleware';
import { AuditService } from './audit.service';

/** Audits every API request to Elasticsearch, and forwards the trail to an external webhook when one is configured. */
@Module({
  providers: [AuditService, AuditForwarder, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService, AuditForwarder],
})
export class AuditModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}
