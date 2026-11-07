import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Client, estypes } from '@elastic/elasticsearch';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Citation, Gap, OrgUnit, Paper, Person, Question, Topic, Work } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { spineEdges } from './spine';
import type { SpineDto, TopicDetailDto, TopicsQueryDto, TopicSort, TopicSummaryDto } from './topics.dto';

const SORTS: Record<TopicSort, estypes.SortCombinations[]> = {
  risk: [{ healthScore: 'asc' }, { momentum: 'asc' }, { bin: 'asc' }, { id: 'asc' }],
  health: [{ healthScore: 'desc' }, { momentum: 'desc' }, { id: 'asc' }],
  momentum: [{ momentum: 'asc' }, { healthScore: 'asc' }, { id: 'asc' }],
  name: [{ 'name.keyword': 'asc' }],
  bin: [{ bin: 'asc' }, { healthScore: 'asc' }, { id: 'asc' }],
};

const personRef = (p: Pick<Person, 'id' | 'name' | 'initials'>) => ({ id: p.id, name: p.name, initials: p.initials });

@Injectable()
export class TopicsService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
  ) {}

  async list(user: Person, q: TopicsQueryDto): Promise<TopicSummaryDto[]> {
    const filter: estypes.QueryDslQueryContainer[] = [await this.scope.filter(user, 'id')];
    if (q.bin) filter.push({ term: { bin: q.bin } });
    if (q.health) filter.push({ term: { health: q.health } });

    const topics = sources(
      await this.es.search<Topic>({ index: ALIASES.topics, size: MAX_DOCS, query: { bool: { filter } }, sort: SORTS[q.sort ?? 'risk'] }),
    );
    const leads = await getMany<Person>(this.es, ALIASES.people, topics.map((t) => t.leadId), ['id', 'name', 'initials']);
    return topics.map((t) => {
      const lead = leads.get(t.leadId);
      return { ...t, lead: lead ? personRef(lead) : null };
    });
  }

  async get(user: Person, id: string): Promise<TopicDetailDto> {
    const topic = await this.visibleTopic(user, id);
    const [units, leads, staffed] = await Promise.all([
      getMany<OrgUnit>(this.es, ALIASES.orgUnits, [topic.teamId, topic.centerId].filter((x): x is string => !!x)),
      getMany<Person>(this.es, ALIASES.people, [topic.leadId], ['id', 'name', 'initials']),
      this.es.search<Person>({
        index: ALIASES.people,
        size: MAX_DOCS,
        query: { nested: { path: 'allocations', query: { term: { 'allocations.topicId': id } } } },
      }),
    ]);
    const people = sources(staffed)
      .map((p) => ({ person: personRef(p), fte: p.allocations.filter((a) => a.topicId === id).reduce((s, a) => s + a.fte, 0) }))
      .sort((a, b) => b.fte - a.fte || a.person.name.localeCompare(b.person.name));
    const lead = leads.get(topic.leadId);
    const ref = (unitId: string | null) => {
      const u = unitId ? units.get(unitId) : undefined;
      return u ? { id: u.id, name: u.name } : null;
    };
    return { ...topic, lead: lead ? personRef(lead) : null, team: ref(topic.teamId), center: ref(topic.centerId), people };
  }

  /** The whole traceability spine with one msearch across five indices filtered on topicId. */
  async spine(user: Person, id: string): Promise<SpineDto> {
    await this.visibleTopic(user, id);
    const body = { size: MAX_DOCS, query: { term: { topicId: id } }, sort: [{ id: 'asc' as const }] };
    const indices = [ALIASES.questions, ALIASES.gaps, ALIASES.work, ALIASES.papers, ALIASES.citations];
    const { responses } = await this.es.msearch({ searches: indices.flatMap((index) => [{ index }, body]) });
    const [questions, gaps, work, papers, citations] = responses.map((r, i) => {
      if ('error' in r) throw new Error(`spine query on ${indices[i]} failed: ${JSON.stringify(r.error)}`);
      return sources(r as { hits: { hits: { _source?: unknown }[] } });
    }) as [Question[], Gap[], Work[], Paper[], Citation[]];

    const records = { questions, gaps, work, papers, citations };
    return { topicId: id, ...records, edges: spineEdges(records) };
  }

  /** The topic if it exists and is in the user's scope; 404 otherwise. */
  private async visibleTopic(user: Person, id: string): Promise<Topic> {
    ScopeService.assertInScope(await this.scope.topicScope(user), id);
    const topic = (await getMany<Topic>(this.es, ALIASES.topics, [id])).get(id);
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }
}
