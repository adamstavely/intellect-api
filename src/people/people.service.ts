import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { getMany, readAll, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Person, Topic } from '../model/types';
import { ScopeService, type TopicScope } from '../scope/scope.service';
import type { PersonDetailDto, PersonSummaryDto } from './people.dto';

const fte = (allocations: Person['allocations']) => Math.round(allocations.reduce((s, a) => s + a.fte, 0) * 10) / 10;

/**
 * A person as the caller may see them, field by field (never the stored document as it is): allocations only on
 * topics in the caller's scope. Load and capacity count all their work, so what lies outside the scope is given only
 * as one total, `otherFte`, without the topics it is on.
 */
export function summarise(p: Person, scope: TopicScope): PersonSummaryDto {
  const visible = p.allocations.filter((a) => ScopeService.inScope(scope, a.topicId));
  const load = fte(p.allocations);
  return {
    id: p.id,
    name: p.name,
    initials: p.initials,
    role: p.role,
    title: p.title,
    team: p.team,
    allocations: visible.map((a) => ({ topicId: a.topicId, fte: a.fte })),
    capacity: p.capacity,
    started: p.started,
    ended: p.ended,
    load,
    otherFte: Math.max(0, Math.round((load - fte(visible)) * 10) / 10),
    overCapacity: load > p.capacity,
  };
}

@Injectable()
export class PeopleService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  async list(user: Person): Promise<PersonSummaryDto[]> {
    const scope = await this.scope.topicScope(user);
    const people = await readAll<Person>(this.es, ALIASES.people, {
      query: { bool: { filter: [ScopeService.peopleFilter(scope, user)] } },
      sort: [{ 'name.keyword': 'asc' }],
    });
    return people.map((p) => summarise(p, scope));
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

    const summary = summarise(person, scope);
    const visible = summary.allocations;
    const topics = await getMany<Pick<Topic, 'id' | 'name'>>(this.es, ALIASES.topics, visible.map((a) => a.topicId), ['id', 'name']);
    return {
      ...summary,
      topics: visible.map((a) => ({ topic: { id: a.topicId, name: topics.get(a.topicId)?.name ?? a.topicId }, fte: a.fte })),
    };
  }
}
