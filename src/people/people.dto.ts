import { PersonDto } from '../model/model.dto';

export class TopicRefDto {
  id!: string;
  name!: string;
}

export class PersonAllocationDto {
  topic!: TopicRefDto;
  fte!: number;
}

export class PersonSummaryDto extends PersonDto {
  /** Total allocated FTE. */
  load!: number;
  /** load > capacity */
  overCapacity!: boolean;
}

export class PersonDetailDto extends PersonSummaryDto {
  /** Allocations with topic names; only topics in the caller's scope are listed. */
  topics!: PersonAllocationDto[];
}
