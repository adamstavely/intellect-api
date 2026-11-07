import { Controller, Get } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { PartnerLabsDto } from './partners.dto';
import { PartnersService } from './partners.service';

@ApiTags('partners')
@ApiSecurity('intellect-user')
@Controller('partners')
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /** Partner labs we've published with, in the caller's scope: joint papers, and who started each. */
  @Get()
  list(@CurrentUser() user: Person): Promise<PartnerLabsDto> {
    return this.partners.labs(user);
  }
}
