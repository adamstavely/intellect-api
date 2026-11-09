import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';
import { buildOpenApi } from './openapi';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // On SIGTERM: stop taking requests and finish those in flight, then drain the audit queue, then close Elasticsearch.
  app.enableShutdownHooks();
  configureApp(app);
  SwaggerModule.setup('docs', app, buildOpenApi(app), { jsonDocumentUrl: 'docs/openapi.json' });
  await app.listen(app.get(ConfigService).getOrThrow<number>('port'));
}

void bootstrap();
