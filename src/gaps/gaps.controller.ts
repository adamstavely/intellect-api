import { Controller, Get, Query } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { GapListItemDto, GapsQueryDto } from './gaps.dto';
import { GapsService } from './gaps.service';

@ApiTags('gaps')
@ApiSecurity('intellect-user')
@Controller('gaps')
export class GapsController {
  constructor(private readonly gaps: GapsService) {}

  /** Gaps in the caller's scope. The dashboard's "Gaps needing attention" is `attention=true&limit=5`. */
  @Get()
  list(@CurrentUser() user: Person, @Query() query: GapsQueryDto): Promise<GapListItemDto[]> {
    return this.gaps.list(user, query);
  }
}
