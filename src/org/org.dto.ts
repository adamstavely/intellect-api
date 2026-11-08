import { CollaborationCountsDto, PersonRefDto, RecentPapersDto } from '../model/model.dto';

export class HealthMixDto {
  healthy!: number;
  watch!: number;
  atRisk!: number;
}

export class RollupBudgetDto {
  allocated!: number;
  spent!: number;
}

export class OrgRollupDto {
  topics!: number;
  healthMix!: HealthMixDto;
  /** Mean healthScore; null with no topics. */
  avgHealthScore!: number | null;
  /** The band that mean falls in, by the same thresholds as a topic's; null with no topics. */
  health!: 'healthy' | 'watch' | 'at-risk' | null;
  openGaps!: number;
  /** Share of open gaps covered by active work, across the unit's topics. 1 when there are none. */
  coverage!: number;
  fte!: number;
  budget!: RollupBudgetDto;
  /** Papers published across the unit's topics. */
  papers!: number;
  /** How many of those papers were unilateral vs. joint; the two sum to `papers`. */
  collaboration!: CollaborationCountsDto;
  /** Papers published last month and so far this month across the unit's topics, counted live. */
  recentPapers!: RecentPapersDto;
  /** Work items across the unit's topics (the sum of each topic's `stats.work`). */
  work!: number;
  /** Mean topic health per month, oldest first, aligned on the latest month. */
  trend!: number[];
  /** Change in that mean health over the momentum lookback, in health points. */
  momentum!: number;
}

export class OrgTopicDto {
  id!: string;
  name!: string;
  bin!: number;
  health!: 'healthy' | 'watch' | 'at-risk';
  healthScore!: number;
  momentum!: number;
  leadId!: string;
  openGaps!: number;
  coverage!: number;
  fte!: number;
}

export class OrgTeamDto {
  id!: string;
  name!: string;
  code!: string | null;
  lead!: PersonRefDto | null;
  rollup!: OrgRollupDto;
  topics!: OrgTopicDto[];
}

export class OrgCenterDto {
  id!: string;
  name!: string;
  code!: string | null;
  /** The center's logo, a URL; null shows its code instead. */
  logo!: string | null;
  focus!: string | null;
  lead!: PersonRefDto | null;
  rollup!: OrgRollupDto;
  teams!: OrgTeamDto[];
}

export class OrgDto {
  centers!: OrgCenterDto[];
  /** Teams that belong to no center. */
  otherTeams!: OrgTeamDto[];
}
