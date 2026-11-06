import { ApiProperty } from '@nestjs/swagger';

export class AllocationDto {
  @ApiProperty() topicId!: string;
  @ApiProperty() fte!: number;
}

export class TopicScopeDto {
  @ApiProperty({ description: 'True for the Chief: every topic is in scope.' })
  all!: boolean;

  @ApiProperty({ type: [String], required: false, description: 'Topic ids in scope when `all` is false.' })
  topicIds?: string[];
}

export class MeDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() initials!: string;
  @ApiProperty({ enum: ['chief', 'pi', 'staff', 'postdoc'] }) role!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) team!: string | null;
  @ApiProperty({ type: [AllocationDto] }) allocations!: AllocationDto[];
  @ApiProperty() capacity!: number;
  @ApiProperty({ type: TopicScopeDto }) scope!: TopicScopeDto;
}
