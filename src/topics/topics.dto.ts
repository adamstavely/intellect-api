import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CitationDto, GapDto, PaperDto, PersonRefDto, QuestionDto, RecentPapersDto, TopicDto, WorkDto } from '../model/model.dto';

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
  /** Papers published last month and so far this month, counted live. */
  recentPapers!: RecentPapersDto;
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

export class CreateTopicBudgetDto {
  /** $M allocated. */
  @IsNumber()
  @Min(0)
  allocated!: number;

  /** Fiscal year, e.g. FY26. Defaults to the current US federal fiscal year. */
  @IsOptional()
  @Matches(/^FY\d{2}$/)
  fy?: string;
}

export class CreateTopicDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  summary?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  bin!: number;

  /** Defaults from the bin: 1 Flagship, 2–3 Core, 4 Emerging. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  priorityLabel?: string;

  /** Team org-unit id; the center comes from the team. */
  @IsString()
  teamId!: string;

  /** A PI may only create topics they lead. */
  @IsString()
  leadId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  sponsors?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateTopicBudgetDto)
  budget?: CreateTopicBudgetDto;

  /** Full-time equivalents planned for the topic, 0–20 in steps of 0.1; default 0. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(20)
  plannedFte?: number;

  /** Opening research questions, owned by the lead. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  questions?: string[];
}
