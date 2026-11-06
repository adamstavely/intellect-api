import { Inject, Injectable } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Person } from '../model/types';

/** Topics a user can see: `all` for the Chief, otherwise an explicit list of ids. */
export type TopicScope = { all: true } | { all: false; topicIds: string[] };

/**
 * Turns the current user into one Elastic filter clause. Every query goes through it.
 * The Chief sees everything; anyone else sees topics they lead or have FTE on.
 */
@Injectable()
export class ScopeService {
  constructor(@Inject(ES_CLIENT) private readonly es: Client) {}

  async topicScope(user: Person): Promise<TopicScope> {
    if (user.role === 'chief') return { all: true };

    const led = await this.es.search<{ id: string }>({
      index: ALIASES.topics,
      size: 10_000,
      _source: ['id'],
      query: { term: { leadId: user.id } },
    });
    const ids = new Set(led.hits.hits.map((h) => h._source!.id));
    for (const a of user.allocations) if (a.fte > 0) ids.add(a.topicId);
    return { all: false, topicIds: [...ids].sort() };
  }

  /**
   * A filter clause restricting a query to the user's topics. `field` is the topic id field of
   * the index being queried: `id` on `topics`, `topicId` everywhere else.
   */
  async filter(user: Person, field: 'id' | 'topicId' = 'topicId'): Promise<estypes.QueryDslQueryContainer> {
    return ScopeService.toFilter(await this.topicScope(user), field);
  }

  static toFilter(scope: TopicScope, field: 'id' | 'topicId'): estypes.QueryDslQueryContainer {
    return scope.all ? { match_all: {} } : { terms: { [field]: scope.topicIds } };
  }
}
