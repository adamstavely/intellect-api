import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Client, errors, estypes } from '@elastic/elasticsearch';
import { Clock } from '../common/clock';
import { getMany, readAll, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import type { Citation, Gap, OrgUnit, Paper, Person, Question, Topic, TopicRequest, Work } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { TopicRollupService } from '../topic-health/topic-rollup.service';
import { fiscalYear, PRIORITY_LABEL, requestHash, tidy, topicIdFor, topicRequestId } from './create-topic';
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
const shown = ({ idempotencyKey: _key, idempotencyHash: _hash, ...t }: Topic): Topic => ({ ...t, priorityType: t.priorityType ?? 'internal' });

const KEY_REUSED = 'This Idempotency-Key was already used for a different topic, or with different details';

const isConflict = (err: unknown) => err instanceof errors.ResponseError && err.statusCode === 409;

/** The ids a topic with this name may take, in order: `t-<slug>`, then -2, -3… */
const topicIdCandidates = (name: string): string[] => {
  const base = topicIdFor(name);
  return Array.from({ length: 50 }, (_, i) => (i ? `${base}-${i + 1}` : base));
};

type Reservation = { record: TopicRequest; seqNo: number; primaryTerm: number };

type QuestionIds = (topicId: string, i: number) => string;
/** The i-th opening question's id: fixed by the topic, so writing the questions again doesn't duplicate them. */
const questionId: QuestionIds = (topicId, i) => `${topicId}-q${i + 1}`;
/** Ids from before they were scoped to the topic: 32 bits of hash. Only for finishing a topic created back then. */
const legacyQuestionId: QuestionIds = (topicId, i) => `q-${createHash('sha256').update(`${topicId}:${i}`).digest('hex').slice(0, 8)}`;

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
   * New Topic flow: the topic plus its opening questions. Rollups (health, stats) are then computed like any other
   * write; a topic with no gaps starts at full coverage.
   *
   * With an idempotency key, creation is a recoverable operation tracked on the key's `topic-requests` record: it is
   * `pending` from the reservation until an attempt has written the topic, its questions and its rollups, then
   * `completed`. Every write is idempotent – the topic goes to the id the record reserves and each question to an id
   * fixed by the topic – so any attempt (a retry, or one racing another with the same key) re-applies them and finishes
   * the same topic. A failed attempt deletes nothing, since another attempt may have finished that topic meanwhile: it
   * leaves the record pending and returns an error, and a retry with the key completes it. A repeat after completion
   * returns the topic without writing anything. A repeat must be the same request (by `requestHash`); different details
   * under the key are a conflict.
   *
   * Without a key the topic is this request's alone, so if its questions can't be written both are removed.
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
    const hash = key ? requestHash(body) : undefined;
    const legacy = key ? await this.byIdempotencyKey(key) : undefined;
    if (legacy) {
      // A topic created before request hashes were kept can only be checked on what it stored.
      const same = legacy.idempotencyHash
        ? legacy.idempotencyHash === hash
        : legacy.name === body.name.trim() && legacy.leadId === body.leadId && legacy.teamId === team.id;
      if (!same) throw new ConflictException(KEY_REUSED);
      await this.writeQuestions(legacy, texts, legacy.idempotencyHash ? questionId : legacyQuestionId);
      await this.rollups.recompute(legacy.id, today);
      return this.get(user, legacy.id);
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
      ...(key ? { idempotencyKey: key, idempotencyHash: hash } : {}),
    };
    if (!key) return this.createUnkeyed(user, topic, texts, today);

    const reservation = await this.reserve(key, hash!, topic.name);
    if (reservation.record.status === 'completed') return this.get(user, reservation.record.topicId);
    try {
      topic.id = await this.createReserved(topic, key, hash!, reservation);
      await this.writeQuestions(topic, texts);
      await this.rollups.recompute(topic.id, today);
      await this.complete(key);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Nothing is undone: the writes are idempotent, and another attempt under the key may already have finished.
      this.#log.error(`Topic for Idempotency-Key ${topicRequestId(key)} not finished: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        `Could not finish creating the topic${topic.id ? ` ${topic.id}` : ''}; retry with the same Idempotency-Key to finish it`,
      );
    }
    return this.get(user, topic.id);
  }

  /** A topic no other request can share: if its questions can't be written, it is removed again. */
  private async createUnkeyed(user: Person, topic: Topic, texts: string[], today: string): Promise<TopicDetailDto> {
    topic.id = await this.createWithUniqueId(topic);
    try {
      await this.writeQuestions(topic, texts);
    } catch (err) {
      const undone = await this.removeTopic(topic.id);
      this.#log.error(`Opening questions for ${topic.id} not saved: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        undone ? 'Could not save the opening questions; the topic was not created' : `Could not save the opening questions for ${topic.id}`,
      );
    }
    await this.rollups.recompute(topic.id, today);
    return this.get(user, topic.id);
  }

  /** Marks the key's creation finished. Idempotent: racing attempts that both finish write the same state. */
  private async complete(key: string): Promise<void> {
    await this.es.update({
      index: ALIASES.topicRequests,
      id: topicRequestId(key),
      doc: { status: 'completed', completedAt: new Date().toISOString() },
      refresh: 'wait_for',
      retry_on_conflict: 3,
    });
  }

  /**
   * A topic created under this key before keys had their own records (`topic-requests`), if any. Topics created since
   * carry the key too, but their record is what guards it.
   */
  private async byIdempotencyKey(key: string): Promise<Topic | undefined> {
    const recorded = await this.es.exists({ index: ALIASES.topicRequests, id: topicRequestId(key) });
    if (recorded) return undefined;
    const res = await this.es.search<Topic>({ index: ALIASES.topics, size: 1, query: { term: { idempotencyKey: key } } });
    return sources(res)[0];
  }

  /**
   * Creates a keyed topic exactly once. The key's record is created first (op_type create, so only one request can),
   * reserving a topic id; every attempt under the key – the first, a concurrent one, or a retry after a lost response –
   * then writes the topic at that id with op_type create too. Whichever lands first makes it; the others find it there,
   * carrying the key, and finish that one. Returns the topic's id.
   */
  private async createReserved(topic: Topic, key: string, hash: string, reservation: Reservation): Promise<string> {
    let { record, seqNo, primaryTerm } = reservation;
    for (let n = 0; n < 50; n++) {
      try {
        await this.es.create({ index: ALIASES.topics, id: record.topicId, document: { ...topic, id: record.topicId }, refresh: 'wait_for' });
        return record.topicId;
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
      const there = (await getMany<Topic>(this.es, ALIASES.topics, [record.topicId], ['idempotencyKey'])).get(record.topicId);
      // Another attempt under this key wrote it (or this one did, and its response was lost).
      if (there?.idempotencyKey === key) return record.topicId;
      // Gone again (removed since the conflict): try the same id.
      if (!there) continue;
      // A different topic took the id between reserving and writing: move the reservation, unless another attempt
      // under this key already has, in which case follow it.
      const topicId = await this.freeTopicId(topic.name);
      try {
        const res = await this.es.update({
          index: ALIASES.topicRequests,
          id: topicRequestId(key),
          if_seq_no: seqNo,
          if_primary_term: primaryTerm,
          doc: { topicId },
          refresh: 'wait_for',
        });
        record = { ...record, topicId };
        seqNo = res._seq_no!;
        primaryTerm = res._primary_term!;
      } catch (err) {
        if (!isConflict(err)) throw err;
        ({ record, seqNo, primaryTerm } = await this.reserve(key, hash, topic.name));
      }
    }
    throw new InternalServerErrorException(`Could not reserve an id for "${topic.name}"`);
  }

  /** The key's record, created with a free topic id if this is the key's first use. A different request under the key is a conflict. */
  private async reserve(key: string, hash: string, name: string): Promise<Reservation> {
    const id = topicRequestId(key);
    const existing = await this.es.get<TopicRequest>({ index: ALIASES.topicRequests, id }, { ignore: [404] });
    let found = existing.found ? existing : undefined;
    if (!found) {
      const record: TopicRequest = { key, requestHash: hash, topicId: await this.freeTopicId(name), status: 'pending', createdAt: new Date().toISOString() };
      try {
        const res = await this.es.create({ index: ALIASES.topicRequests, id, document: record, refresh: 'wait_for' });
        return { record, seqNo: res._seq_no!, primaryTerm: res._primary_term! };
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
      // Another request created it first.
      found = await this.es.get<TopicRequest>({ index: ALIASES.topicRequests, id });
    }
    if (found._source!.requestHash !== hash) throw new ConflictException(KEY_REUSED);
    return { record: found._source!, seqNo: found._seq_no!, primaryTerm: found._primary_term! };
  }

  /** The first of `t-<slug>`, `t-<slug>-2`… not taken by a topic. Only a candidate: it is claimed by creating the topic. */
  private async freeTopicId(name: string): Promise<string> {
    const candidates = topicIdCandidates(name);
    const taken = await getMany<Topic>(this.es, ALIASES.topics, candidates, ['id']);
    const id = candidates.find((c) => !taken.has(c));
    if (!id) throw new BadRequestException(`Too many topics named like "${name}"`);
    return id;
  }

  /**
   * Writes the opening questions. Ids are fixed per topic, so ones already written are left as they are – after
   * checking that each id taken really is this topic's question, so a clash fails instead of losing the question.
   */
  private async writeQuestions(topic: Pick<Topic, 'id' | 'leadId'>, texts: string[], ids: QuestionIds = questionId): Promise<void> {
    if (!texts.length) return;
    const questions: Question[] = texts.map((text, i) => ({ id: ids(topic.id, i), topicId: topic.id, text, status: 'open', ownerId: topic.leadId }));
    const res = await this.es.bulk({
      refresh: 'wait_for',
      operations: questions.flatMap((q) => [{ create: { _index: ALIASES.questions, _id: q.id } }, q]),
    });
    const failed = res.items.filter((i) => i.create?.error && i.create.status !== 409);
    if (failed.length) throw new Error(`${failed.length} of ${questions.length} questions rejected: ${failed[0].create?.error?.reason ?? ''}`);

    const taken = questions.filter((_, i) => res.items[i].create?.status === 409);
    if (!taken.length) return;
    const stored = await getMany<Question>(this.es, ALIASES.questions, taken.map((q) => q.id));
    const clash = taken.find((q) => stored.get(q.id)?.topicId !== q.topicId || stored.get(q.id)?.text !== q.text);
    if (clash) throw new Error(`Question id ${clash.id} is already used by ${stored.get(clash.id)?.topicId ?? 'a record that is gone'}`);
  }

  /**
   * Best-effort undo of a half-made topic created without a key – one no other request can have written to: its
   * questions, then the topic. False when something was left behind. Never used for a keyed topic.
   */
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
    for (const id of topicIdCandidates(topic.name)) {
      try {
        await this.es.create({ index: ALIASES.topics, id, document: { ...topic, id }, refresh: 'wait_for' });
        return id;
      } catch (err) {
        if (!isConflict(err)) throw err;
      }
    }
    throw new BadRequestException(`Too many topics named like "${topic.name}"`);
  }

  async list(user: Person, q: TopicsQueryDto): Promise<TopicSummaryDto[]> {
    const filter: estypes.QueryDslQueryContainer[] = [await this.scope.filter(user, 'id')];
    if (q.bin) filter.push({ term: { bin: q.bin } });
    if (q.health) filter.push({ term: { health: q.health } });

    // Every topic in scope, ordered by Elasticsearch over all of them.
    const topics = await readAll<Topic>(this.es, ALIASES.topics, { query: { bool: { filter } }, sort: SORTS[q.sort ?? 'risk'] });
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
      readAll<Person>(this.es, ALIASES.people, { query: { nested: { path: 'allocations', query: { term: { 'allocations.topicId': id } } } } }),
      recentPaperCounts(this.es, [id], this.clock.today()),
    ]);
    const people = staffed
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

  /** The whole traceability spine: every record of the topic in five indices, however many (see `readAll`). */
  async spine(user: Person, id: string): Promise<SpineDto> {
    await this.visibleTopic(user, id);
    const body = { query: { term: { topicId: id } }, sort: [{ id: 'asc' as const }] };
    const [questions, gaps, work, papers, citations] = await Promise.all([
      readAll<Question>(this.es, ALIASES.questions, body),
      readAll<Gap>(this.es, ALIASES.gaps, body),
      readAll<Work>(this.es, ALIASES.work, body),
      readAll<Paper>(this.es, ALIASES.papers, body),
      readAll<Citation>(this.es, ALIASES.citations, body),
    ]);

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
