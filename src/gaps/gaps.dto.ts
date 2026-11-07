import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { GapDto, PersonRefDto } from '../model/model.dto';

export class GapsQueryDto {
  /** Only open gaps with no active work against them, most severe (then least healthy topic) first. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  attention?: boolean;

  /** 1–100, default 20. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  topicId?: string;

  @IsOptional()
  @IsIn(['critical', 'high', 'medium'])
  severity?: 'critical' | 'high' | 'medium';

  @IsOptional()
  @IsIn(['open', 'addressing', 'closing', 'closed'])
  status?: 'open' | 'addressing' | 'closing' | 'closed';
}

export class GapTopicRefDto {
  id!: string;
  name!: string;
  health!: 'healthy' | 'watch' | 'at-risk';
  healthScore!: number;
  /** The topic's priority tier, 1 (top) to 4. */
  bin!: number;
}

export class GapListItemDto extends GapDto {
  topic!: GapTopicRefDto;
  owner!: PersonRefDto | null;
  /** At least one active work item is against this gap. */
  covered!: boolean;
  /** Active work items against this gap; covered when 1 or more. */
  activeWork!: number;
  /** What the work in flight against this gap (anything not complete) has been allocated. */
  invested!: GapInvestmentDto;
}

export class GapInvestmentDto {
  /** Budget allocated, in $M. */
  budget!: number;
  fte!: number;
}
