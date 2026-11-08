import { ALIASES } from '../elastic/indices';
import type { MetricsSource } from '../metrics/metrics-source';
import type {
  Citation,
  Gap,
  OrgUnit,
  Paper,
  PaperMetrics,
  Person,
  PersonRole,
  Question,
  Topic,
  TopicHealthHistory,
  Work,
} from '../model/types';
import {
  healthBand,
  healthBreakdown,
  momentum,
  snapshotDate,
  topicStats,
  trailingMonths,
} from '../topic-health/topic-health';
import type { PrototypeData } from './prototype';

export interface SeedDoc<T> {
  id: string;
  doc: T;
}

export interface SeedDocuments {
  [ALIASES.people]: SeedDoc<Person>[];
  [ALIASES.orgUnits]: SeedDoc<OrgUnit>[];
  [ALIASES.topics]: SeedDoc<Topic>[];
  [ALIASES.questions]: SeedDoc<Question>[];
  [ALIASES.gaps]: SeedDoc<Gap>[];
  [ALIASES.work]: SeedDoc<Work>[];
  [ALIASES.papers]: SeedDoc<Paper>[];
  [ALIASES.paperMetrics]: SeedDoc<PaperMetrics>[];
  [ALIASES.citations]: SeedDoc<Citation>[];
  [ALIASES.topicHealthHistory]: SeedDoc<TopicHealthHistory>[];
}

export interface SeedResult {
  docs: SeedDocuments;
  /** Inconsistencies found in the prototype data and how they were resolved. */
  warnings: string[];
}

const ROLE_BY_TITLE: Record<string, PersonRole> = {
  Chief: 'chief',
  PI: 'pi',
  Staff: 'staff',
  Postdoc: 'postdoc',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The directorate isn't a team; people in it get `team: null`. */
const NON_TEAMS = ['Directorate'];

export const teamId = (name: string): string =>
  `team-${name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/**
 * Converts the prototype dataset into documents for every index (plan §1):
 * - each link is stored once, on the child (gap.questionIds, work.gapIds, paper.workIds,
 *   citation.paperId); the prototype's reverse links are folded in and dropped;
 * - every record carries `topicId`;
 * - the prototype's hand-set health, coverage and momentum are ignored and recomputed as of
 *   `asOf`, and 12 months of topic-health-history are backfilled by replaying the formula at
 *   each month end against the current records (the prototype has no record history).
 */
export async function transformPrototype(
  data: PrototypeData,
  metrics: MetricsSource,
  asOf: string,
): Promise<SeedResult> {
  const warnings: string[] = [];
  const topicIds = new Set(data.topics.map((t) => t.id));
  const personIds = new Set(Object.keys(data.people));

  const checkTopic = (kind: string, id: string, topic: string) => {
    if (!topicIds.has(topic)) throw new Error(`${kind} ${id} references unknown topic ${topic}`);
  };
  const checkPeople = (kind: string, id: string, ids: string[]) => {
    for (const p of ids) if (!personIds.has(p)) throw new Error(`${kind} ${id} references unknown person ${p}`);
  };

  // ---- Org units: centers from subLabs, teams from the team names people and topics use.
  const centerByTeam = new Map<string, string>();
  const orgUnits: OrgUnit[] = data.subLabs.map((c) => {
    c.teams.forEach((t) => centerByTeam.set(t, c.id));
    return { id: c.id, kind: 'center', name: c.name, code: c.code, logo: c.logo ?? null, parentId: null, leadId: c.lead ?? null, focus: c.focus ?? null };
  });
  const teamNames = new Set(
    [...Object.values(data.people).map((p) => p.team), ...data.topics.map((t) => t.team)].filter(
      (n) => !NON_TEAMS.includes(n),
    ),
  );
  for (const name of [...teamNames].sort()) {
    const pis = Object.values(data.people).filter((p) => p.team === name && p.title === 'PI');
    if (pis.length !== 1) warnings.push(`team "${name}" has ${pis.length} PIs; leadId set to ${pis[0]?.id ?? 'null'}`);
    if (!centerByTeam.has(name)) warnings.push(`team "${name}" belongs to no center`);
    orgUnits.push({
      id: teamId(name),
      kind: 'team',
      name,
      code: null,
      logo: null,
      parentId: centerByTeam.get(name) ?? null,
      leadId: pis[0]?.id ?? null,
      focus: null,
    });
  }

  // ---- People
  const people: Person[] = Object.values(data.people).map((p) => {
    const role = ROLE_BY_TITLE[p.title];
    if (!role) throw new Error(`person ${p.id} has unknown title ${p.title}`);
    (p.alloc ?? []).forEach(([t]) => checkTopic('allocation of', p.id, t));
    return {
      id: p.id,
      name: p.name,
      initials: p.init,
      role,
      title: p.role,
      team: NON_TEAMS.includes(p.team) ? null : teamId(p.team),
      allocations: (p.alloc ?? []).map(([topicId, fte]) => ({ topicId, fte })),
      capacity: p.cap ?? 1,
      started: p.start,
      ended: p.end ?? null,
    };
  });

  // ---- Questions; their gap links move onto the gaps.
  const questionIdsByGap = new Map<string, Set<string>>();
  const questions: Question[] = data.questions.map((q) => {
    checkTopic('question', q.id, q.topic);
    checkPeople('question', q.id, [q.owner]);
    q.gaps.forEach((g) => addTo(questionIdsByGap, g, q.id));
    return { id: q.id, topicId: q.topic, text: q.text, status: q.status, ownerId: q.owner };
  });

  // ---- Work; links from gap.work are folded into work.gapIds, and work.papers moves onto papers.
  const gapIdsByWork = new Map<string, Set<string>>();
  for (const w of data.work) w.gaps.forEach((g) => addTo(gapIdsByWork, w.id, g));
  for (const g of data.gaps) {
    for (const wid of g.work) {
      if (!gapIdsByWork.get(wid)?.has(g.id)) {
        warnings.push(`gap ${g.id} lists work ${wid} but ${wid} doesn't list ${g.id}; kept the link on ${wid}`);
        addTo(gapIdsByWork, wid, g.id);
      }
    }
  }
  const workIdsByPaper = new Map<string, Set<string>>();
  const work: Work[] = data.work.map((w) => {
    checkTopic('work', w.id, w.topic);
    checkPeople('work', w.id, [w.lead, ...w.team]);
    w.papers.forEach((p) => addTo(workIdsByPaper, p, w.id));
    return {
      id: w.id,
      topicId: w.topic,
      title: w.title,
      status: w.status,
      leadId: w.lead,
      memberIds: w.team,
      progress: w.progress,
      due: w.due,
      budget: { allocated: w.budget.allocated, spent: w.budget.spent },
      fte: w.fte,
      gapIds: sorted(gapIdsByWork.get(w.id)),
      note: w.note,
    };
  });

  // ---- Gaps
  const gaps: Gap[] = data.gaps.map((g) => {
    checkTopic('gap', g.id, g.topic);
    checkPeople('gap', g.id, [g.owner]);
    return {
      id: g.id,
      topicId: g.topic,
      text: g.text,
      severity: g.severity,
      status: g.status,
      ownerId: g.owner,
      questionIds: sorted(questionIdsByGap.get(g.id)),
    };
  });

  // ---- Papers, metrics and citations
  const papers: Paper[] = [];
  const paperMetrics: PaperMetrics[] = [];
  const citations: Citation[] = [];
  for (const p of data.papers) {
    checkTopic('paper', p.id, p.topic);
    checkPeople('paper', p.id, p.authors);
    const monthIndex = MONTHS.indexOf(p.month);
    if (monthIndex < 0) throw new Error(`paper ${p.id} has unknown month ${p.month}`);
    const published = `${p.year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    if (p.initiatedBy && !p.partners?.includes(p.initiatedBy)) throw new Error(`paper ${p.id} was initiated by ${p.initiatedBy}, which isn't one of its partners`);
    papers.push({
      id: p.id,
      topicId: p.topic,
      title: p.title,
      venue: p.venue,
      published,
      authorIds: p.authors,
      partners: p.partners ?? [],
      initiatedBy: p.initiatedBy ?? null,
      questionIds: p.addresses,
      gapIds: p.gaps,
      workIds: sorted(workIdsByPaper.get(p.id)),
      grade: null,
      gradedBy: null,
      gradedAt: null,
      feedback: p.feedback.map((f) => ({ ...f })),
    });
    paperMetrics.push(...(await metrics.monthly({ paperId: p.id, topicId: p.topic, published }, asOf)));
    for (const c of p.citedBy) {
      citations.push({ id: c.id, paperId: p.id, topicId: p.topic, title: c.title, venue: c.venue, year: c.year, org: c.org, sector: c.sector });
    }
  }

  // ---- Topics: stats, health, history, momentum — all recomputed.
  const months = trailingMonths(asOf, 12);
  const history: TopicHealthHistory[] = [];
  const topics: Topic[] = data.topics.map((t) => {
    const tGaps = gaps.filter((g) => g.topicId === t.id);
    const tWork = work.filter((w) => w.topicId === t.id);
    const fte = people.reduce((s, p) => s + p.allocations.filter((a) => a.topicId === t.id).reduce((x, a) => x + a.fte, 0), 0);

    const trend = months.map((month) => {
      const b = healthBreakdown({ gaps: tGaps, work: tWork, asOf: snapshotDate(month, asOf) });
      history.push({ topicId: t.id, month, healthScore: b.score, coverage: round3(b.coverage) });
      return b.score;
    });
    const score = trend[trend.length - 1];

    return {
      id: t.id,
      name: t.name,
      summary: t.summary,
      bin: t.bin,
      priorityLabel: t.priority,
      healthScore: score,
      health: healthBand(score),
      leadId: t.lead,
      teamId: teamId(t.team),
      centerId: centerByTeam.get(t.team) ?? null,
      tags: t.tags,
      sponsors: t.sponsors,
      budget: { allocated: t.budget.allocated, spent: t.budget.spent, fy: t.budget.fy },
      // The prototype has no staffing plan; seed one at today's allocation.
      plannedFte: Math.round(fte * 10) / 10,
      stats: topicStats({
        questions: questions.filter((q) => q.topicId === t.id).length,
        papers: papers.filter((p) => p.topicId === t.id),
        fte,
        gaps: tGaps,
        work: tWork,
        asOf,
      }),
      momentum: momentum(trend),
      trend,
    };
  });

  const byId = <T extends { id: string }>(xs: T[]): SeedDoc<T>[] => xs.map((doc) => ({ id: doc.id, doc }));
  return {
    warnings,
    docs: {
      [ALIASES.people]: byId(people),
      [ALIASES.orgUnits]: byId(orgUnits),
      [ALIASES.topics]: byId(topics),
      [ALIASES.questions]: byId(questions),
      [ALIASES.gaps]: byId(gaps),
      [ALIASES.work]: byId(work),
      [ALIASES.papers]: byId(papers),
      [ALIASES.paperMetrics]: paperMetrics.map((doc) => ({ id: `${doc.paperId}:${doc.month}`, doc })),
      [ALIASES.citations]: byId(citations),
      [ALIASES.topicHealthHistory]: history.map((doc) => ({ id: `${doc.topicId}:${doc.month}`, doc })),
    },
  };
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

const sorted = (set: Set<string> | undefined): string[] => [...(set ?? [])].sort();
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
