import { Controller, Get, Query } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { SearchQueryDto, SearchResultsDto } from './search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiSecurity('intellect-user')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /** ⌘K search over topics, gaps, papers and people (prefix matching on the last word). */
  @Get()
  search(@CurrentUser() user: Person, @Query() query: SearchQueryDto): Promise<SearchResultsDto> {
    return this.searchService.search(user, query);
  }
}
