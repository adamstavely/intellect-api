import { PersonDto } from '../model/model.dto';

export class TopicScopeDto {
  /** True for the Chief: every topic is in scope. */
  all!: boolean;
  /** Topic ids in scope when `all` is false. */
  topicIds?: string[];
}

export class MeDto extends PersonDto {
  scope!: TopicScopeDto;
}
