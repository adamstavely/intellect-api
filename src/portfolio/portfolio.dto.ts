import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

export class HistoryQueryDto {
  /** Months of history, ending this month: 6–60, default 24. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(6)
  @Max(60)
  months?: number;

  /** Months to forecast after this one: 1–24, default 6. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  horizon?: number;
}

export class ForecastPointDto {
  value!: number;
  /** The low and high ends of an 80% range around `value`. */
  low!: number;
  high!: number;
}

export class HistorySeriesDto {
  /** The value now: the last of `actual`. */
  current!: number;
  /** One value per month in `months`. */
  actual!: number[];
  /** One point per month in `forecastMonths`: a straight-line trend through the last twelve months. */
  forecast!: ForecastPointDto[];
}

export class PortfolioHistoryDto {
  /** The history's months, YYYY-MM, oldest first, ending this month. */
  months!: string[];
  /** The forecast's months, after `months`. */
  forecastMonths!: string[];
  /** Papers published to date, in the caller's scope: a running total. */
  papers!: HistorySeriesDto;
  /** People here at each month's end, in the caller's scope. */
  people!: HistorySeriesDto;
}
