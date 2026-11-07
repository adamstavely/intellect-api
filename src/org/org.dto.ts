import { CollaborationCountsDto, PersonRefDto } from '../model/model.dto';

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
  openGaps!: number;
  /** Share of open gaps covered by active work, across the unit's topics. 1 when there are none. */
  coverage!: number;
  fte!: number;
  budget!: RollupBudgetDto;
  /** Papers published across the unit's topics. */
  papers!: number;
  /** How many of those papers were unilateral vs. joint; the two sum to `papers`. */
  collaboration!: CollaborationCountsDto;
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
