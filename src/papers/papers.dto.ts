import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';
import {
  AudienceDto,
  CitationDto,
  GeoShareDto,
  MentionsDto,
  PaperDto,
  PaperMetricsDto,
  PersonRefDto,
  SplitDto,
} from '../model/model.dto';
import { TopicRefDto } from '../people/people.dto';

export const PAPER_GRADE_FILTERS = ['outstanding', 'excellent', 'satisfactory', 'dissatisfactory', 'ungraded'] as const;

export class PapersQueryDto {
  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsIn(PAPER_GRADE_FILTERS)
  grade?: (typeof PAPER_GRADE_FILTERS)[number];

  /** `published` (newest first, default) or `reads` (most views first). */
  @IsOptional()
  @IsIn(['published', 'reads'])
  sort?: 'published' | 'reads';
}

export class TopPapersQueryDto {
  /** 1–20, default 3. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;

  /** `ytd` (default), `FY26`, `FY26-Q2` or a month, `2026-11`. */
  @IsOptional()
  @IsString()
  period?: string;
}

export class MetricTotalsDto {
  downloads!: number;
  views!: number;
  citations!: number;
  /** Latest attention score. */
  altmetric!: number;
  mentions!: MentionsDto;
}

export class FirstCitationDto {
  /** YYYY-MM of the first month with a citation; null while the paper hasn't been cited. */
  month!: string | null;
  /** Whole months from the publication month to that month (0 = cited the month it came out); null while uncited. */
  monthsAfterPublication!: number | null;
}

export class CenterRefDto {
  id!: string;
  name!: string;
  code!: string | null;
}

export class PaperListItemDto extends PaperDto {
  topic!: TopicRefDto;
  authors!: PersonRefDto[];
  /** The centers the authors' teams are in, each once, in author order; authors outside a team add none. */
  authorCenters!: CenterRefDto[];
  /** Lifetime totals. */
  totals!: MetricTotalsDto;
  /** Time to first citation, from monthly metrics. */
  firstCitation!: FirstCitationDto;
}

export class FirstCitationQueryDto {
  /** Only this topic's papers; unset for every paper in the caller's scope. */
  @IsOptional()
  @IsString()
  topicId?: string;
}

export class FirstCitationSummaryDto {
  /** Papers in scope. */
  papers!: number;
  /** Papers cited at least once. */
  cited!: number;
  /** Papers not cited yet. */
  awaiting!: number;
  /** Median months from publication to first citation, over cited papers; null with none cited. */
  medianMonths!: number | null;
  /** The quickest and slowest first citations, in months; null with none cited. */
  fastestMonths!: number | null;
  slowestMonths!: number | null;
  /** For papers still awaiting a first citation: the longest any has waited so far, in months; null with none waiting. */
  longestWaitMonths!: number | null;
}

export class TopPaperDto extends PaperListItemDto {
  /** Totals within the requested period. */
  periodTotals!: MetricTotalsDto;
}

export class PaperDetailDto extends PaperListItemDto {
  /** One entry per month, oldest first. */
  metrics!: PaperMetricsDto[];
  /** Shares from the latest month; null with no metrics. */
  audience!: AudienceDto | null;
  geo!: GeoShareDto[];
  split!: SplitDto | null;
  citations!: CitationDto[];
}

export const PAPER_GRADES = ['outstanding', 'excellent', 'satisfactory', 'dissatisfactory'] as const;

export class GradePaperDto {
  /** The new grade, or null to clear it. */
  @ValidateIf((_, value) => value !== null)
  @IsIn(PAPER_GRADES)
  grade!: 'outstanding' | 'excellent' | 'satisfactory' | 'dissatisfactory' | null;
}
