import { IsOptional, IsString } from 'class-validator';
import { CollaborationCountsDto } from '../model/model.dto';
import { HealthMixDto, RollupBudgetDto } from '../org/org.dto';

export class PortfolioQueryDto {
  /** `ytd` (default), `FY26`, `FY26-Q2` or a month, `2026-11` (US federal fiscal year: FY26 starts 2025-10-01). */
  @IsOptional()
  @IsString()
  period?: string;
}

export class PeriodDto {
  label!: string;
  /** Inclusive YYYY-MM-DD; `to` is capped at today. */
  from!: string;
  to!: string;
}

export class BinMixDto {
  bin!: number;
  topics!: number;
  atRisk!: number;
}

export class MonthlyReadsDto {
  /** YYYY-MM */
  month!: string;
  views!: number;
  downloads!: number;
}

export class PortfolioSummaryDto {
  period!: PeriodDto;
  topics!: number;
  /** Questions not yet answered. */
  activeQuestions!: number;
  openGaps!: number;
  /** Share of open gaps covered by active work, portfolio-wide. 1 when there are none. */
  gapsCovered!: number;
  /** Work items not complete. */
  workInFlight!: number;
  avgHealthScore!: number | null;
  healthMix!: HealthMixDto;
  binMix!: BinMixDto[];
  papersInPeriod!: number;
  /** The period's papers split into unilateral and joint; the two sum to `papersInPeriod`. */
  collaborationInPeriod!: CollaborationCountsDto;
  readsInPeriod!: number;
  downloadsInPeriod!: number;
  citationsInPeriod!: number;
  /** Twelve months ending at the period's last month. */
  readTrend!: MonthlyReadsDto[];
  budget!: RollupBudgetDto;
  fte!: number;
}
