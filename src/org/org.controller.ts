import { Controller, Get } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { OrgDto } from './org.dto';
import { OrgService } from './org.service';

@ApiTags('org')
@ApiSecurity('intellect-user')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** Centers → teams → topic roll-ups. */
  @Get()
  tree(@CurrentUser() user: Person): Promise<OrgDto> {
    return this.org.tree(user);
  }
}
