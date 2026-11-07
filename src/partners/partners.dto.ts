import { TopicRefDto } from '../people/people.dto';

export class PartnerPaperDto {
  id!: string;
  title!: string;
  venue!: string;
  /** YYYY-MM-DD */
  published!: string;
  topic!: TopicRefDto;
  /** Who started it, from this lab's side: we did, this lab did, or another partner on the paper did. */
  initiatedBy!: 'us' | 'partner' | 'other-partner';
  /** The lab that started it; null when we did. */
  initiator!: string | null;
  /** The paper's other partner labs. */
  otherPartners!: string[];
  /** Lifetime citations and views. */
  citations!: number;
  views!: number;
}

export class PartnerLabDto {
  name!: string;
  /** Joint papers written with this lab. */
  joint!: number;
  /** Of those, the ones we started with them... */
  initiatedByUs!: number;
  /** ...the ones they started with us... */
  initiatedByThem!: number;
  /** ...and the ones another partner on the paper started. */
  initiatedByOthers!: number;
  /** Lifetime citations and views of the joint papers. */
  citations!: number;
  views!: number;
  /** Topics the joint papers are in, by name. */
  topics!: TopicRefDto[];
  /** The latest joint paper's publication date, YYYY-MM-DD. */
  lastPublished!: string;
  /** The joint papers, newest first. */
  papers!: PartnerPaperDto[];
}

export class PartnerLabsDto {
  /** Every paper in the caller's scope. */
  papers!: number;
  /** Papers written with at least one partner lab. */
  joint!: number;
  /** Joint papers we started. */
  initiatedByUs!: number;
  /** Joint papers a partner lab started. */
  initiatedByPartners!: number;
  /** Labs we've published with, most joint papers first. */
  labs!: PartnerLabDto[];
}
