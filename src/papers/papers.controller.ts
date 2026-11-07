import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { GradePaperDto, PaperDetailDto, PaperListItemDto, PapersQueryDto, TopPaperDto, TopPapersQueryDto } from './papers.dto';
import { PapersService } from './papers.service';

@ApiTags('papers')
@ApiSecurity('intellect-user')
@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  @Get()
  list(@CurrentUser() user: Person, @Query() query: PapersQueryDto): Promise<PaperListItemDto[]> {
    return this.papers.list(user, query);
  }

  /** Dashboard "Impact pulse": most-read papers in the period. Declared before `:id`. */
  @Get('top')
  top(@CurrentUser() user: Person, @Query() query: TopPapersQueryDto): Promise<TopPaperDto[]> {
    return this.papers.top(user, query);
  }

  /** Paper detail with monthly metrics, audience, geo and citing works. */
  @Get(':id')
  get(@CurrentUser() user: Person, @Param('id') id: string): Promise<PaperDetailDto> {
    return this.papers.get(user, id);
  }

  /** Grade a paper. Chief only. */
  @Patch(':id/grade')
  @Roles('chief')
  @ApiForbiddenResponse({ description: 'Caller is not the Chief' })
  grade(@CurrentUser() user: Person, @Param('id') id: string, @Body() body: GradePaperDto): Promise<PaperDetailDto> {
    return this.papers.grade(user, id, body);
  }
}
