import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiConflictResponse, ApiForbiddenResponse, ApiHeader, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { CreateTopicDto, SpineDto, TopicDetailDto, TopicsQueryDto, TopicSummaryDto } from './topics.dto';
import { TopicsService } from './topics.service';

const IDEMPOTENCY_HEADER = 'idempotency-key';
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

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

  /**
   * New Topic flow: creates the topic and its opening questions. Chief, or a PI creating a topic they lead.
   * Send an Idempotency-Key to make retries safe: a repeat of the same request finishes the topic that key created
   * instead of making another. The key sent again with different details is refused (409).
   */
  @Post()
  @Roles('chief', 'pi')
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: false, description: 'Up to 200 of A–Z a–z 0–9 . _ : -; a UUID per New Topic submission is ideal' })
  @ApiForbiddenResponse({ description: 'Not the Chief or a PI, or a PI naming someone else as lead' })
  @ApiBadRequestResponse({ description: 'Validation failed, unknown lead or team, or a malformed Idempotency-Key' })
  @ApiConflictResponse({ description: 'The Idempotency-Key was already used for a different topic, or with different details' })
  create(@CurrentUser() user: Person, @Body() body: CreateTopicDto, @Headers(IDEMPOTENCY_HEADER) key?: string): Promise<TopicDetailDto> {
    if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) throw new BadRequestException(`Malformed ${IDEMPOTENCY_HEADER}`);
    return this.topics.create(user, body, key);
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
