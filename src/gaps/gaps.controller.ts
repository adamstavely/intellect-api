import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { GapListItemDto, GapsQueryDto } from './gaps.dto';
import { GapsService } from './gaps.service';

@ApiTags('gaps')
@ApiSecurity('intellect-user')
@Controller('gaps')
export class GapsController {
  constructor(private readonly gaps: GapsService) {}

  /**
   * Gaps in the caller's scope, most in need of attention first, cut to `limit`. The dashboard's "Gaps needing
   * attention" is `attention=true&limit=5`.
   */
  @Get()
  @ApiOkResponse({
    type: [GapListItemDto],
    headers: { 'X-Total-Count': { description: 'How many gaps matched, before the list was cut to `limit`.', schema: { type: 'integer' } } },
  })
  async list(@CurrentUser() user: Person, @Query() query: GapsQueryDto, @Res({ passthrough: true }) res: Response): Promise<GapListItemDto[]> {
    const { gaps, total } = await this.gaps.list(user, query);
    res.setHeader('X-Total-Count', String(total));
    return gaps;
  }
}
