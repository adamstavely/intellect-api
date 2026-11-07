import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiForbiddenResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { CreateTopicDto, SpineDto, TopicDetailDto, TopicsQueryDto, TopicSummaryDto } from './topics.dto';
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

  /** New Topic flow: creates the topic and its opening questions. Chief, or a PI creating a topic they lead. */
  @Post()
  @Roles('chief', 'pi')
  @ApiForbiddenResponse({ description: 'Not the Chief or a PI, or a PI naming someone else as lead' })
  @ApiBadRequestResponse({ description: 'Validation failed, or unknown lead or team' })
  create(@CurrentUser() user: Person, @Body() body: CreateTopicDto): Promise<TopicDetailDto> {
    return this.topics.create(user, body);
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
