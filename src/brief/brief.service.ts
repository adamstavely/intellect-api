import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { getMany, MAX_DOCS, sources } from '../common/es';
import { ES_CLIENT } from '../elastic/elastic.module';
import { ALIASES } from '../elastic/indices';
import { GapsService } from '../gaps/gaps.service';
import type { Gap, Person, Topic, Work } from '../model/types';
import { OrgService } from '../org/org.service';
import { PapersService } from '../papers/papers.service';
import { PeopleService } from '../people/people.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ScopeService } from '../scope/scope.service';
import { PRIORITY_LABEL } from '../topics/create-topic';
import type { BinInvestmentDto, BriefDto, BriefQueryDto } from './brief.dto';
import { decisions } from './decisions';

const share = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 1000 : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

@Injectable()
export class BriefService {
  constructor(
    @Inject(ES_CLIENT) private readonly es: Client,
    private readonly scope: ScopeService,
    private readonly portfolio: PortfolioService,
    private readonly org: OrgService,
    private readonly gaps: GapsService,
    private readonly papers: PapersService,
    private readonly people: PeopleService,
  ) {}

  async brief(user: Person, q: BriefQueryDto): Promise<BriefDto> {
    const topicScope = await this.scope.topicScope(user);
    const byTopicId = ScopeService.toFilter(topicScope, 'topicId');

    const [atAGlance, org, attention, impact, people, topicsRes, workRes] = await Promise.all([
      this.portfolio.summary(user, { period: q.period }),
      this.org.tree(user),
      this.gaps.list(user, { attention: true, limit: 100 }),
      this.papers.top(user, { period: q.period, limit: 3 }),
      this.people.list(user),
      this.es.search<Topic>({ index: ALIASES.topics, size: MAX_DOCS, query: { bool: { filter: [ScopeService.toFilter(topicScope, 'id')] } } }),
      this.es.search<Work>({ index: ALIASES.work, size: MAX_DOCS, query: { bool: { filter: [byTopicId] } }, sort: [{ due: 'asc' }] }),
    ]);
    const topics = sources(topicsRes);
    const work = sources(workRes);
    const blockedWork = work.filter((w) => w.status === 'blocked');
    const gapsById = await getMany<Gap>(this.es, ALIASES.gaps, blockedWork.flatMap((w) => w.gapIds));
    const exposure = attention.filter((g) => g.severity === 'critical' || g.severity === 'high');

    const totals = { topics: topics.length, budget: sum(topics.map((t) => t.budget.allocated)), fte: sum(topics.map((t) => t.stats.fte)) };
    const investment: BinInvestmentDto[] = [1, 2, 3, 4].map((bin) => {
      const ts = topics.filter((t) => t.bin === bin);
      const budget = round(sum(ts.map((t) => t.budget.allocated)), 2);
      const fte = round(sum(ts.map((t) => t.stats.fte)), 1);
      return { bin, label: PRIORITY_LABEL[bin], topics: ts.length, topicShare: share(ts.length, totals.topics), budget, budgetShare: share(budget, totals.budget), fte, fteShare: share(fte, totals.fte) };
    });

    const atRisk = topics.filter((t) => t.health === 'at-risk').sort((a, b) => a.healthScore - b.healthScore);
    const steepest = [...topics].sort((a, b) => a.momentum - b.momentum)[0];
    const s = atAGlance;
    const executiveSummary = [
      `${count(s.topics, 'topic')} in scope: ${s.healthMix.healthy} healthy, ${s.healthMix.watch} on watch, ${s.healthMix.atRisk} at risk.`,
      `${pct(s.gapsCovered)} of ${count(s.openGaps, 'open gap')} have active work; ${count(exposure.length, 'critical or high gap')} have none.`,
      ...(atRisk.length ? [`Most at risk: ${atRisk.slice(0, 3).map((t) => `${t.name} (${t.healthScore})`).join(', ')}.`] : []),
      ...(steepest && steepest.momentum < 0 ? [`Steepest decline: ${steepest.name}, ${steepest.momentum} points over three months.`] : []),
      `${count(s.papersInPeriod, 'paper')} published in ${s.period.label}, with ${s.readsInPeriod.toLocaleString('en-US')} reads and ${s.citationsInPeriod.toLocaleString('en-US')} citations.`,
      ...(blockedWork.length ? [`${count(blockedWork.length, 'work item is', 'work items are')} blocked.`] : []),
    ];

    return {
      period: s.period,
      generatedAt: new Date().toISOString(),
      preparedFor: { id: user.id, name: user.name, initials: user.initials },
      executiveSummary,
      atAGlance,
      centers: org.centers.map(({ teams: _teams, focus: _focus, ...c }) => c),
      exposure,
      investment,
      impact,
      decisions: decisions({ topics, blockedWork, allWork: work, gaps: gapsById, people }),
    };
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
