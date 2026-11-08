import { Controller, Get, Query } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { HistoryQueryDto, PortfolioHistoryDto, PortfolioQueryDto, PortfolioSummaryDto } from './portfolio.dto';
import { PortfolioService } from './portfolio.service';

@ApiTags('portfolio')
@ApiSecurity('intellect-user')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  /** Dashboard KPIs, health mix, bin mix and coverage ring for the caller's scope. */
  @Get('summary')
  summary(@CurrentUser() user: Person, @Query() query: PortfolioQueryDto): Promise<PortfolioSummaryDto> {
    return this.portfolio.summary(user, query);
  }

  /** Papers to date and headcount by month, with a six-month forecast: the Summary's Papers and People cards. */
  @Get('history')
  history(@CurrentUser() user: Person, @Query() query: HistoryQueryDto): Promise<PortfolioHistoryDto> {
    return this.portfolio.history(user, query);
  }
}
