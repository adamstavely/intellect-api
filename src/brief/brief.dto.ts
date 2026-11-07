import { IsOptional, IsString } from 'class-validator';
import { PersonRefDto } from '../model/model.dto';
import { GapListItemDto } from '../gaps/gaps.dto';
import { OrgRollupDto } from '../org/org.dto';
import { TopPaperDto } from '../papers/papers.dto';
import { PeriodDto, PortfolioSummaryDto } from '../portfolio/portfolio.dto';

export class BriefQueryDto {
  /** `FY26-Q2`, `FY26` or `ytd` (default). */
  @IsOptional()
  @IsString()
  period?: string;
}

export class CenterScoreDto {
  id!: string;
  name!: string;
  code!: string | null;
  lead!: PersonRefDto | null;
  rollup!: OrgRollupDto;
}

export class BinInvestmentDto {
  bin!: number;
  label!: string;
  topics!: number;
  /** Shares are 0–1 of the scoped portfolio total. */
  topicShare!: number;
  /** $M allocated. */
  budget!: number;
  budgetShare!: number;
  fte!: number;
  fteShare!: number;
}

export class DecisionDto {
  tag!: 'Resourcing' | 'Operations' | 'Portfolio';
  /** One-line ask. */
  lead!: string;
  /** Why, from the data. */
  body!: string;
  topicId!: string | null;
}

/** Directorate Brief: structured sections computed from the data (no LLM in milestone 1). */
export class BriefDto {
  period!: PeriodDto;
  generatedAt!: string;
  preparedFor!: PersonRefDto;
  /** 01 Executive summary: plain-sentence findings. */
  executiveSummary!: string[];
  /** 02 Portfolio at a glance. */
  atAGlance!: PortfolioSummaryDto;
  /** 03 Centers scorecard. */
  centers!: CenterScoreDto[];
  /** 04 Exposure register: open critical/high gaps with no active work. */
  exposure!: GapListItemDto[];
  /** 05 Investment vs priority, by bin. */
  investment!: BinInvestmentDto[];
  /** 06 Impact highlights: most-read papers in the period. */
  impact!: TopPaperDto[];
  /** 07 Decisions requested: rule-based prompts, most urgent first. */
  decisions!: DecisionDto[];
}
