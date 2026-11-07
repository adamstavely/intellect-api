import { Inject, Injectable } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Gap, Paper, Person, Topic } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import type { SearchHitDto, SearchQueryDto, SearchResultsDto } from './search.dto';

/** ⌘K search: one msearch over topics, gaps, papers and people, scoped like everything else. */
@Injectable()
export class SearchService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  async search(user: Person, { q, limit = 5 }: SearchQueryDto): Promise<SearchResultsDto> {
    const scope = await this.scope.topicScope(user);
    const text = q.trim();
    const match = (fields: string[], extra: estypes.QueryDslQueryContainer[] = []) => ({
      bool: {
        should: [{ multi_match: { query: text, type: 'bool_prefix' as const, fields, operator: 'and' as const } }, ...extra],
        minimum_should_match: 1,
      },
    });
    const body = (query: estypes.QueryDslQueryContainer, filter: estypes.QueryDslQueryContainer) => ({
      size: limit,
      query: { bool: { must: [query], filter: [filter] } },
    });

    const { responses } = await this.es.msearch({
      searches: [
        { index: ALIASES.topics },
        body(match(['name^3', 'summary'], [{ term: { tags: { value: text.toLowerCase(), boost: 2 } } }]), ScopeService.toFilter(scope, 'id')),
        { index: ALIASES.gaps },
        body(match(['text']), ScopeService.toFilter(scope, 'topicId')),
        { index: ALIASES.papers },
        body(match(['title^2'], [{ term: { venue: { value: text } } }]), ScopeService.toFilter(scope, 'topicId')),
        { index: ALIASES.people },
        body(match(['name']), ScopeService.peopleFilter(scope, user)),
      ],
    });
    const hits = <T>(i: number): { _source: T; _score: number }[] => {
      const r = responses[i];
      if ('error' in r) throw new Error(`search failed: ${JSON.stringify(r.error)}`);
      return r.hits.hits.map((h) => ({ _source: h._source as T, _score: h._score ?? 0 }));
    };
    const hit = (id: string, label: string, detail: string, topicId: string | null, score: number): SearchHitDto => ({ id, label, detail, topicId, score });

    return {
      topics: hits<Topic>(0).map(({ _source: t, _score }) => hit(t.id, t.name, t.health, null, _score)),
      gaps: hits<Gap>(1).map(({ _source: g, _score }) => hit(g.id, g.text, g.severity, g.topicId, _score)),
      papers: hits<Paper>(2).map(({ _source: p, _score }) => hit(p.id, p.title, p.venue, p.topicId, _score)),
      people: hits<Person>(3).map(({ _source: p, _score }) => hit(p.id, p.name, p.title, null, _score)),
    };
  }
}
