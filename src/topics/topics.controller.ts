import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { SpineDto, TopicDetailDto, TopicsQueryDto, TopicSummaryDto } from './topics.dto';
import { TopicsService } from './topics.service';

@ApiTags('topics')
@ApiSecurity('intellect-user')
@Controller('topics')
export class TopicsController {
  constructor(private readonly topics: TopicsService) {}

  /** Topics in the caller's scope; the dashboard priorities table uses `sort=risk`. */
  @Get()
  list(@CurrentUser() user: Person, @Query() query: TopicsQueryDto): Promise<TopicSummaryDto[]> {
    return this.topics.list(user, query);
  }

  /** Topic header and resourcing strip. */
  @Get(':id')
  get(@CurrentUser() user: Person, @Param('id') id: string): Promise<TopicDetailDto> {
    return this.topics.get(user, id);
  }

  /** Traceability spine: Question → Gap → Work → Paper → Citation. */
  @Get(':id/spine')
  spine(@CurrentUser() user: Person, @Param('id') id: string): Promise<SpineDto> {
    return this.topics.spine(user, id);
  }
}
