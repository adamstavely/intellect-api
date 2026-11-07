import { BadRequestException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client, errors, estypes } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Citation, Gap, OrgUnit, Paper, Person, Question, Topic, Work } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { TopicRollupService } from '../topic-health/topic-rollup.service';
import { fiscalYear, PRIORITY_LABEL, tidy, topicIdFor } from './create-topic';
import { spineEdges } from './spine';
import type { CreateTopicDto, SpineDto, TopicDetailDto, TopicsQueryDto, TopicSort, TopicSummaryDto } from './topics.dto';

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
    private readonly rollups: TopicRollupService,
    private readonly clock: Clock,
  ) {}

  /**
   * New Topic flow: the topic plus its opening questions. Elastic has no transactions, so the
   * questions are written after the topic and a failure removes both. Rollups (health, stats) are
   * then computed like any other write; a topic with no gaps starts at full coverage.
   */
  async create(user: Person, body: CreateTopicDto): Promise<TopicDetailDto> {
    if (user.role !== 'chief' && body.leadId !== user.id) throw new ForbiddenException('A PI can only create topics they lead');

    const [people, units] = await Promise.all([
      getMany<Person>(this.es, ALIASES.people, [body.leadId], ['id']),
      getMany<OrgUnit>(this.es, ALIASES.orgUnits, [body.teamId]),
    ]);
    if (!people.has(body.leadId)) throw new BadRequestException(`Unknown lead ${body.leadId}`);
    const team = units.get(body.teamId);
    if (!team || team.kind !== 'team') throw new BadRequestException(`Unknown team ${body.teamId}`);

    const today = this.clock.today();
    const topic: Topic = {
      id: '',
      name: body.name.trim(),
      summary: body.summary?.trim() ?? '',
      bin: body.bin as Topic['bin'],
      priorityLabel: body.priorityLabel?.trim() || PRIORITY_LABEL[body.bin],
      healthScore: 100,
      health: 'healthy',
      leadId: body.leadId,
      teamId: team.id,
      centerId: team.parentId,
      tags: tidy(body.tags),
      sponsors: tidy(body.sponsors),
      budget: { allocated: body.budget?.allocated ?? 0, spent: 0, fy: body.budget?.fy ?? fiscalYear(today) },
      stats: { questions: 0, gaps: 0, openGaps: 0, coverage: 1, work: 0, papers: 0, fte: 0, grades: { outstanding: 0, excellent: 0, satisfactory: 0, dissatisfactory: 0, ungraded: 0 } },
      momentum: 0,
      trend: [],
    };
    topic.id = await this.createWithUniqueId(topic);

    const questions = tidy(body.questions).map((text) => ({ id: `q-${randomUUID().slice(0, 8)}`, topicId: topic.id, text, status: 'open' as const, ownerId: topic.leadId }));
    if (questions.length) {
      const res = await this.es.bulk({
        refresh: 'wait_for',
        operations: questions.flatMap((q) => [{ create: { _index: ALIASES.questions, _id: q.id } }, q]),
      });
      if (res.errors) {
        await this.es.deleteByQuery({ index: ALIASES.questions, query: { term: { topicId: topic.id } }, refresh: true });
        await this.es.delete({ index: ALIASES.topics, id: topic.id, refresh: 'wait_for' }, { ignore: [404] });
        throw new InternalServerErrorException('Could not save the opening questions; the topic was not created');
      }
    }

    await this.rollups.recompute(topic.id, today);
    return this.get(user, topic.id);
  }

  /** Creates the topic under `t-<slug>`, adding -2, -3… if the id is taken. */
  private async createWithUniqueId(topic: Topic): Promise<string> {
    const base = topicIdFor(topic.name);
    for (let n = 1; n <= 50; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        await this.es.create({ index: ALIASES.topics, id, document: { ...topic, id }, refresh: 'wait_for' });
        return id;
      } catch (err) {
        if (!(err instanceof errors.ResponseError && err.statusCode === 409)) throw err;
      }
    }
    throw new BadRequestException(`Too many topics named like "${topic.name}"`);
  }

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
