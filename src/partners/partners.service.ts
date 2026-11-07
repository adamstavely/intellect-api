import { Injectable } from '@nestjs/common';
import type { Person } from '../model/types';
import { PapersService } from '../papers/papers.service';
import { partnerLabs } from './partner-labs';
import type { PartnerLabsDto } from './partners.dto';

@Injectable()
export class PartnersService {
  constructor(private readonly papers: PapersService) {}

  /** The labs the caller's papers were written with, from those papers (so scoped as they are). */
  async labs(user: Person): Promise<PartnerLabsDto> {
    return partnerLabs(await this.papers.list(user, {}));
  }
}
