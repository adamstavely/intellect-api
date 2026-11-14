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
  const doc = SwaggerModule.createDocument(app, config);
  // Every endpoint reads Elasticsearch, and a read that comes back incomplete fails rather than answering short.
  for (const [path, item] of Object.entries(doc.paths)) {
    if (path === '/health') continue;
    for (const op of [item.get, item.put, item.post, item.delete, item.patch]) {
      if (op) op.responses['503'] ??= { description: UNAVAILABLE };
    }
  }
  return doc;
}

const UNAVAILABLE =
  'Elasticsearch could not give a complete answer (a search timed out, some shards failed, or the cluster is overloaded or unreachable). Nothing partial is returned; retry.';
