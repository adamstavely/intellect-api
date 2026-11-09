import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions } from '@elastic/elasticsearch';

export const ES_CLIENT = Symbol('ES_CLIENT');

/**
 * Work that must finish before the Elasticsearch client closes at shutdown, such as draining the audit queue. Nest
 * runs the shutdown hooks of different modules in an order that isn't ours to rely on, so the client waits for these.
 */
@Injectable()
export class ElasticShutdown {
  readonly #log = new Logger('Elastic');
  readonly #tasks: (() => Promise<void>)[] = [];

  beforeClose(task: () => Promise<void>): void {
    this.#tasks.push(task);
  }

  async run(): Promise<void> {
    for (const r of await Promise.allSettled(this.#tasks.map((t) => t()))) {
      if (r.status === 'rejected') this.#log.error(`Shutdown task failed: ${(r.reason as Error).message}`);
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ES_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Client(config.getOrThrow<ClientOptions>('elasticsearch')),
    },
    ElasticShutdown,
  ],
  exports: [ES_CLIENT, ElasticShutdown],
})
export class ElasticModule implements OnApplicationShutdown {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly shutdown: ElasticShutdown,
  ) {}

  /** After the HTTP server has closed (Nest's last shutdown phase), once everything that still writes has finished. */
  async onApplicationShutdown(): Promise<void> {
    await this.shutdown.run();
    await this.es.close();
  }
}
