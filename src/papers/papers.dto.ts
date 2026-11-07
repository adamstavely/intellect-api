import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
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

  /** `ytd` (default), `FY26` or `FY26-Q2`. */
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

export class PaperListItemDto extends PaperDto {
  topic!: TopicRefDto;
  authors!: PersonRefDto[];
  /** Lifetime totals. */
  totals!: MetricTotalsDto;
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
