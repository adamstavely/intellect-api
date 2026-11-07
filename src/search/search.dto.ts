import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @Length(1, 200)
  q!: string;

  /** Results per group, 1–20, default 5. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}

export class SearchHitDto {
  id!: string;
  /** Primary text: topic/person name, gap text, paper title. */
  label!: string;
  /** Secondary text: topic health, gap severity, paper venue, person title. */
  detail!: string;
  /** Owning topic; null for topics and people. */
  topicId!: string | null;
  score!: number;
}

export class SearchResultsDto {
  topics!: SearchHitDto[];
  gaps!: SearchHitDto[];
  papers!: SearchHitDto[];
  people!: SearchHitDto[];
}
