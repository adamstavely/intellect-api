import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { StubAuthGuard } from './auth/stub-auth.guard';
import configuration from './config/configuration';
import { ElasticModule } from './elastic/elastic.module';
import { MeController } from './me/me.controller';
import { ProbeModule } from './probe/probe.module';
import { ScopeModule } from './scope/scope.module';
import { TopicHealthModule } from './topic-health/topic-health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ElasticModule,
    ScopeModule,
    TopicHealthModule,
    ProbeModule,
  ],
  controllers: [MeController],
  providers: [{ provide: APP_GUARD, useClass: StubAuthGuard }],
})
export class AppModule {}
