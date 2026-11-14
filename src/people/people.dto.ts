import { AllocationDto, PersonDto } from '../model/model.dto';

export class TopicRefDto {
  id!: string;
  name!: string;
}

export class PersonAllocationDto {
  topic!: TopicRefDto;
  fte!: number;
}

export class PersonSummaryDto extends PersonDto {
  /**
   * Allocations on topics in the caller's scope only (all of them for the Chief). Work elsewhere is counted in
   * `otherFte`, never listed.
   */
  declare allocations: AllocationDto[];
  /** Total allocated FTE, across every topic, in scope or not. */
  load!: number;
  /** FTE on topics outside the caller's scope, as one total; 0 for the Chief. */
  otherFte!: number;
  /** load > capacity */
  overCapacity!: boolean;
}

export class PersonDetailDto extends PersonSummaryDto {
  /** Allocations with topic names; only topics in the caller's scope are listed. */
  topics!: PersonAllocationDto[];
}
