import { Controller, Get, Query } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { BriefDto, BriefQueryDto } from './brief.dto';
import { BriefService } from './brief.service';

@ApiTags('brief')
@ApiSecurity('intellect-user')
@Controller('brief')
export class BriefController {
  constructor(private readonly briefs: BriefService) {}

  /** Directorate Brief for the period, scoped to the caller. */
  @Get()
  brief(@CurrentUser() user: Person, @Query() query: BriefQueryDto): Promise<BriefDto> {
    return this.briefs.brief(user, query);
  }
}
