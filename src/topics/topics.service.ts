import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { NO_RECENT_PAPERS, recentPaperCounts } from '../papers/recent-papers';
import type { CreateTopicDto, SpineDto, TopicDetailDto, TopicsQueryDto, TopicSort, TopicSummaryDto } from './topics.dto';

const SORTS: Record<TopicSort, estypes.SortCombinations[]> = {
  risk: [{ healthScore: 'asc' }, { momentum: 'asc' }, { bin: 'asc' }, { id: 'asc' }],
  health: [{ healthScore: 'desc' }, { momentum: 'desc' }, { id: 'asc' }],
  momentum: [{ momentum: 'asc' }, { healthScore: 'asc' }, { id: 'asc' }],
  name: [{ 'name.keyword': 'asc' }],
  bin: [{ bin: 'asc' }, { healthScore: 'asc' }, { id: 'asc' }],
};

const personRef = (p: Pick<Person, 'id' | 'name' | 'initials'>) => ({ id: p.id, name: p.name, initials: p.initials });

/**
 * A stored topic as the API returns it: without the creating request's idempotency key. One stored before priority
 * types reads as internal, the default for a new one.
 */
const shown = ({ idempotencyKey: _key, ...t }: Topic): Topic => ({ ...t, priorityType: t.priorityType ?? 'internal' });

/** The i-th opening question's id: fixed by the topic, so writing the questions again doesn't duplicate them. */
const questionId = (topicId: string, i: number) => `q-${createHash('sha256').update(`${topicId}:${i}`).digest('hex').slice(0, 8)}`;

@Injectable()
export class TopicsService {
  readonly #log = new Logger('Topics');

  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
    private readonly rollups: TopicRollupService,
    private readonly clock: Clock,
  ) {}

  /**
   * New Topic flow: the topic plus its opening questions. Elastic has no transactions, so the questions are written
   * after the topic, and if that fails (a rejected item or a failed request) both are removed. Rollups (health, stats)
   * are then computed like any other write; a topic with no gaps starts at full coverage.
   *
   * With an idempotency key, a repeat of the request finishes the topic the first attempt created – writing any missing
   * questions and the rollups – rather than creating a second one. That covers a failure the clean-up couldn't undo,
   * and a lost response. Two attempts racing with the same key can still both create; keys are for retries.
   */
  async create(user: Person, body: CreateTopicDto, idempotencyKey?: string): Promise<TopicDetailDto> {
    if (user.role !== 'chief' && body.leadId !== user.id) throw new ForbiddenException('A PI can only create topics they lead');

    const [people, units] = await Promise.all([
      getMany<Person>(this.es, ALIASES.people, [body.leadId], ['id']),
      getMany<OrgUnit>(this.es, ALIASES.orgUnits, [body.teamId]),
    ]);
    if (!people.has(body.leadId)) throw new BadRequestException(`Unknown lead ${body.leadId}`);
    const team = units.get(body.teamId);
    if (!team || team.kind !== 'team') throw new BadRequestException(`Unknown team ${body.teamId}`);

    const today = this.clock.today();
    const key = idempotencyKey ? `${user.id}:${idempotencyKey}` : undefined;
    const texts = tidy(body.questions);
    const earlier = key ? await this.byIdempotencyKey(key) : undefined;
    if (earlier) {
      if (earlier.name !== body.name.trim() || earlier.leadId !== body.leadId || earlier.teamId !== team.id) {
        throw new ConflictException('This Idempotency-Key was already used to create a different topic');
      }
      await this.writeQuestions(earlier, texts);
      await this.rollups.recompute(earlier.id, today);
      return this.get(user, earlier.id);
    }

    const topic: Topic = {
      id: '',
      name: body.name.trim(),
      summary: body.summary?.trim() ?? '',
      bin: body.bin as Topic['bin'],
      priorityLabel: body.priorityLabel?.trim() || PRIORITY_LABEL[body.bin],
      priorityType: body.priorityType ?? 'internal',
      healthScore: 100,
      health: 'healthy',
      leadId: body.leadId,
      teamId: team.id,
      centerId: team.parentId,
      tags: tidy(body.tags),
      sponsors: tidy(body.sponsors),
      budget: { allocated: body.budget?.allocated ?? 0, spent: 0, fy: body.budget?.fy ?? fiscalYear(today) },
      plannedFte: body.plannedFte ?? 0,
      stats: { questions: 0, gaps: 0, openGaps: 0, coverage: 1, work: 0, papers: 0, fte: 0, grades: { outstanding: 0, excellent: 0, satisfactory: 0, dissatisfactory: 0, ungraded: 0 }, collaboration: { unilateral: 0, joint: 0 } },
      momentum: 0,
      trend: [],
      ...(key ? { idempotencyKey: key } : {}),
    };
    topic.id = await this.createWithUniqueId(topic);

    try {
      await this.writeQuestions(topic, texts);
    } catch (err) {
      const undone = await this.removeTopic(topic.id);
      this.#log.error(`Opening questions for ${topic.id} not saved: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        undone
          ? 'Could not save the opening questions; the topic was not created'
          : `Could not save the opening questions for ${topic.id}${key ? '; retry with the same Idempotency-Key to finish it' : ''}`,
      );
    }

    await this.rollups.recompute(topic.id, today);
    return this.get(user, topic.id);
  }

  /** The topic an earlier request with this key created, if any. */
  private async byIdempotencyKey(key: string): Promise<Topic | undefined> {
    const res = await this.es.search<Topic>({ index: ALIASES.topics, size: 1, query: { term: { idempotencyKey: key } } });
    return sources(res)[0];
  }

  /** Writes the opening questions. Ids are fixed per topic, so ones already written are left as they are. */
  private async writeQuestions(topic: Pick<Topic, 'id' | 'leadId'>, texts: string[]): Promise<void> {
    if (!texts.length) return;
    const questions: Question[] = texts.map((text, i) => ({ id: questionId(topic.id, i), topicId: topic.id, text, status: 'open', ownerId: topic.leadId }));
    const res = await this.es.bulk({
      refresh: 'wait_for',
      operations: questions.flatMap((q) => [{ create: { _index: ALIASES.questions, _id: q.id } }, q]),
    });
    const failed = res.items.filter((i) => i.create?.error && i.create.status !== 409);
    if (failed.length) throw new Error(`${failed.length} of ${questions.length} questions rejected: ${failed[0].create?.error?.reason ?? ''}`);
  }

  /** Best-effort undo of a half-made topic: its questions, then the topic. False when something was left behind. */
  private async removeTopic(id: string): Promise<boolean> {
    try {
      const res = await this.es.deleteByQuery({ index: ALIASES.questions, query: { term: { topicId: id } }, refresh: true, conflicts: 'proceed' });
      // Keep the topic if its questions didn't all go, so its id isn't reused while they're still there.
      if (res.failures?.length) throw new Error(`${res.failures.length} questions not deleted`);
      await this.es.delete({ index: ALIASES.topics, id, refresh: 'wait_for' }, { ignore: [404] });
      return true;
    } catch (err) {
      this.#log.error(`Could not remove the incomplete topic ${id}: ${(err as Error).message}`);
      return false;
    }
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
    const [leads, recent] = await Promise.all([
      getMany<Person>(this.es, ALIASES.people, topics.map((t) => t.leadId), ['id', 'name', 'initials']),
      recentPaperCounts(this.es, topics.map((t) => t.id), this.clock.today()),
    ]);
    return topics.map((t) => {
      const lead = leads.get(t.leadId);
      return { ...shown(t), lead: lead ? personRef(lead) : null, recentPapers: recent.get(t.id) ?? NO_RECENT_PAPERS };
    });
  }

  async get(user: Person, id: string): Promise<TopicDetailDto> {
    const topic = await this.visibleTopic(user, id);
    const [units, leads, staffed, recent] = await Promise.all([
      getMany<OrgUnit>(this.es, ALIASES.orgUnits, [topic.teamId, topic.centerId].filter((x): x is string => !!x)),
      getMany<Person>(this.es, ALIASES.people, [topic.leadId], ['id', 'name', 'initials']),
      this.es.search<Person>({
        index: ALIASES.people,
        size: MAX_DOCS,
        query: { nested: { path: 'allocations', query: { term: { 'allocations.topicId': id } } } },
      }),
      recentPaperCounts(this.es, [id], this.clock.today()),
    ]);
    const people = sources(staffed)
      .map((p) => ({ person: personRef(p), fte: p.allocations.filter((a) => a.topicId === id).reduce((s, a) => s + a.fte, 0) }))
      .sort((a, b) => b.fte - a.fte || a.person.name.localeCompare(b.person.name));
    const lead = leads.get(topic.leadId);
    const ref = (unitId: string | null) => {
      const u = unitId ? units.get(unitId) : undefined;
      return u ? { id: u.id, name: u.name } : null;
    };
    return {
      ...shown(topic),
      lead: lead ? personRef(lead) : null,
      recentPapers: recent.get(id) ?? NO_RECENT_PAPERS,
      team: ref(topic.teamId),
      center: ref(topic.centerId),
      people,
    };
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
