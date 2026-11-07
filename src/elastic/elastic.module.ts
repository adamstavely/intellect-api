import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions } from '@elastic/elasticsearch';

export const ES_CLIENT = Symbol('ES_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: ES_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Client(config.getOrThrow<ClientOptions>('elasticsearch')),
    },
  ],
  exports: [ES_CLIENT],
})
export class ElasticModule implements OnApplicationShutdown {
  constructor(@Inject(ES_CLIENT) private readonly es: Client) {}

  async onApplicationShutdown(): Promise<void> {
    await this.es.close();
  }
}
