import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { RolesGuard } from './auth/roles';
import { StubAuthGuard } from './auth/stub-auth.guard';
import { BriefController } from './brief/brief.controller';
import { BriefService } from './brief/brief.service';
import { Clock } from './common/clock';
import configuration from './config/configuration';
import { ElasticModule } from './elastic/elastic.module';
import { GapsController } from './gaps/gaps.controller';
import { GapsService } from './gaps/gaps.service';
import { MeController } from './me/me.controller';
import { OrgController } from './org/org.controller';
import { OrgService } from './org/org.service';
import { PapersController } from './papers/papers.controller';
import { PapersService } from './papers/papers.service';
import { PeopleController } from './people/people.controller';
import { PeopleService } from './people/people.service';
import { PortfolioController } from './portfolio/portfolio.controller';
import { PortfolioService } from './portfolio/portfolio.service';
import { ProbeModule } from './probe/probe.module';
import { ScopeModule } from './scope/scope.module';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { TopicHealthModule } from './topic-health/topic-health.module';
import { TopicsController } from './topics/topics.controller';
import { TopicsService } from './topics/topics.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ElasticModule,
    ScopeModule,
    TopicHealthModule,
    ProbeModule,
    AuditModule,
  ],
  controllers: [
    MeController,
    PeopleController,
    PortfolioController,
    TopicsController,
    GapsController,
    PapersController,
    OrgController,
    SearchController,
    BriefController,
  ],
  providers: [
    Clock,
    PeopleService,
    PortfolioService,
    TopicsService,
    GapsService,
    PapersService,
    OrgService,
    SearchService,
    BriefService,
    { provide: APP_GUARD, useClass: StubAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }) },
  ],
})
export class AppModule {}
