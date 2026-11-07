import { Controller, Get, Param } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user';
import type { Person } from '../model/types';
import { PersonDetailDto, PersonSummaryDto } from './people.dto';
import { PeopleService } from './people.service';

@ApiTags('people')
@ApiSecurity('intellect-user')
@Controller('people')
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /** People visible to the caller: everyone for the Chief, otherwise the caller and their topics' staff. */
  @Get()
  list(@CurrentUser() user: Person): Promise<PersonSummaryDto[]> {
    return this.people.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: Person, @Param('id') id: string): Promise<PersonDetailDto> {
    return this.people.get(user, id);
  }
}
