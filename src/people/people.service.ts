import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Person, Topic } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import type { PersonDetailDto, PersonSummaryDto } from './people.dto';

export function summarise(p: Person): PersonSummaryDto {
  const load = Math.round(p.allocations.reduce((s, a) => s + a.fte, 0) * 10) / 10;
  return { ...p, load, overCapacity: load > p.capacity };
}

@Injectable()
export class PeopleService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  async list(user: Person): Promise<PersonSummaryDto[]> {
    const scope = await this.scope.topicScope(user);
    const res = await this.es.search<Person>({
      index: ALIASES.people,
      size: MAX_DOCS,
      query: { bool: { filter: [ScopeService.peopleFilter(scope, user)] } },
      sort: [{ 'name.keyword': 'asc' }],
    });
    return sources(res).map(summarise);
  }

  async get(user: Person, id: string): Promise<PersonDetailDto> {
    const scope = await this.scope.topicScope(user);
    const res = await this.es.search<Person>({
      index: ALIASES.people,
      size: 1,
      query: { bool: { filter: [{ term: { id } }, ScopeService.peopleFilter(scope, user)] } },
    });
    const [person] = sources(res);
    if (!person) throw new NotFoundException('Person not found');

    const visible = person.allocations.filter((a) => ScopeService.inScope(scope, a.topicId));
    const topics = await getMany<Pick<Topic, 'id' | 'name'>>(this.es, ALIASES.topics, visible.map((a) => a.topicId), ['id', 'name']);
    return {
      ...summarise(person),
      topics: visible.map((a) => ({ topic: { id: a.topicId, name: topics.get(a.topicId)?.name ?? a.topicId }, fte: a.fte })),
    };
  }
}
