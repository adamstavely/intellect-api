import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Client } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';

@Injectable()
export class ElasticsearchHealthIndicator {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly health: HealthIndicatorService,
  ) {}

  /** Up when the cluster answers and isn't red (a single-node dev cluster is normally yellow). */
  async isHealthy(key = 'elasticsearch') {
    const indicator = this.health.check(key);
    try {
      const res = await this.es.cluster.health({ timeout: '3s' }, { requestTimeout: 5000 });
      return res.status === 'red'
        ? indicator.down({ cluster: res.status })
        : indicator.up({ cluster: res.status });
    } catch (err) {
      return indicator.down({ message: err instanceof Error ? err.message : String(err) });
    }
  }
}
