import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CitationDto, GapDto, PaperDto, PersonRefDto, QuestionDto, TopicDto, WorkDto } from '../model/model.dto';

export const TOPIC_SORTS = ['risk', 'name', 'health', 'momentum', 'bin'] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];

export class TopicsQueryDto {
  /** `risk` (default): lowest health first, then falling momentum. `health`: highest first. */
  @IsOptional()
  @IsIn(TOPIC_SORTS)
  sort?: TopicSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  bin?: number;

  @IsOptional()
  @IsIn(['healthy', 'watch', 'at-risk'])
  health?: 'healthy' | 'watch' | 'at-risk';
}

export class TopicSummaryDto extends TopicDto {
  lead!: PersonRefDto | null;
}

export class OrgRefDto {
  id!: string;
  name!: string;
}

export class TopicPersonDto {
  person!: PersonRefDto;
  fte!: number;
}

export class TopicDetailDto extends TopicSummaryDto {
  team!: OrgRefDto | null;
  center!: OrgRefDto | null;
  /** Everyone with FTE on the topic, largest allocation first. */
  people!: TopicPersonDto[];
}

export const SPINE_EDGE_KINDS = ['question-gap', 'gap-work', 'work-paper', 'gap-paper', 'question-paper', 'paper-citation'] as const;
export type SpineEdgeKind = (typeof SPINE_EDGE_KINDS)[number];

export class SpineEdgeDto {
  /** Upstream node id (question → gap → work → paper → citation). */
  from!: string;
  to!: string;
  kind!: 'question-gap' | 'gap-work' | 'work-paper' | 'gap-paper' | 'question-paper' | 'paper-citation';
}

export class SpineDto {
  topicId!: string;
  questions!: QuestionDto[];
  gaps!: GapDto[];
  work!: WorkDto[];
  papers!: PaperDto[];
  citations!: CitationDto[];
  /** Links between the nodes above; edges to records outside the topic are dropped. */
  edges!: SpineEdgeDto[];
}
