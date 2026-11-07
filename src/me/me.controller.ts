import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiSecurity, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { ScopeService } from '../scope/scope.service';
import { MeDto } from './me.dto';

@ApiTags('me')
@ApiSecurity('intellect-user')
@Controller('me')
export class MeController {
  constructor(private readonly scope: ScopeService) {}

  @Get()
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({ description: 'Missing or unknown X-Intellect-User' })
  async me(@CurrentUser() user: Person): Promise<MeDto> {
    return { ...user, scope: await this.scope.topicScope(user) };
  }
}
