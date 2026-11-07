import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { USER_HEADER } from './auth/current-user';

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Intellect API')
    .setDescription('Research-portfolio backend. Auth is stubbed: send X-Intellect-User with a person id.')
    .setVersion(process.env.npm_package_version ?? '0.1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: USER_HEADER }, 'intellect-user')
    .build();
  return SwaggerModule.createDocument(app, config);
}
