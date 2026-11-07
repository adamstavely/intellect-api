/**
 * OpenAPI shapes of the stored documents (src/model/types.ts). Classes so the Swagger CLI plugin
 * can describe them; `implements` keeps them in step with the interfaces.
 */
import type * as M from './types';

export class AllocationDto implements M.Allocation {
  topicId!: string;
  fte!: number;
}

export class PersonDto implements M.Person {
  id!: string;
  name!: string;
  initials!: string;
  role!: 'chief' | 'pi' | 'staff' | 'postdoc';
  /** Job title as displayed, e.g. "Lab Director". */
  title!: string;
  /** Team org-unit id; null for the directorate. */
  team!: string | null;
  allocations!: AllocationDto[];
  capacity!: number;
}

export class PersonRefDto {
  id!: string;
  name!: string;
  initials!: string;
}

export class GradeCountsDto implements M.GradeCounts {
  outstanding!: number;
  excellent!: number;
  satisfactory!: number;
  dissatisfactory!: number;
  ungraded!: number;
}

export class CollaborationCountsDto implements M.CollaborationCounts {
  /** Papers written by the lab alone. */
  unilateral!: number;
  /** Papers written with at least one partner lab. */
  joint!: number;
}

export class RecentPapersDto implements M.RecentPapers {
  /** Papers published in the whole of last calendar month. */
  lastMonth!: number;
  /** Papers published this calendar month, up to today. */
  thisMonth!: number;
}

export class TopicStatsDto implements M.TopicStats {
  questions!: number;
  gaps!: number;
  openGaps!: number;
  /** Share (0–1) of open gaps with at least one active work item. */
  coverage!: number;
  work!: number;
  papers!: number;
  fte!: number;
  /** Paper grade roll-up. */
  grades!: GradeCountsDto;
  /** Unilateral vs. joint papers; the two sum to `papers`. */
  collaboration!: CollaborationCountsDto;
}

export class TopicBudgetDto {
  allocated!: number;
  spent!: number;
  fy!: string;
}

export class TopicDto implements M.Topic {
  id!: string;
  name!: string;
  summary!: string;
  bin!: 1 | 2 | 3 | 4;
  priorityLabel!: string;
  /** 0–100, computed. */
  healthScore!: number;
  health!: 'healthy' | 'watch' | 'at-risk';
  leadId!: string;
  teamId!: string;
  centerId!: string | null;
  tags!: string[];
  sponsors!: string[];
  budget!: TopicBudgetDto;
  /** Full-time equivalents the topic is planned to have; `stats.fte` is what people are actually allocated. */
  plannedFte!: number;
  stats!: TopicStatsDto;
  /** Current healthScore minus the score three months ago. */
  momentum!: number;
  /** Monthly healthScore, oldest first, ending with the current month. */
  trend!: number[];
}

export class QuestionDto implements M.Question {
  id!: string;
  topicId!: string;
  text!: string;
  status!: 'open' | 'partially' | 'answered';
  ownerId!: string;
}

export class GapDto implements M.Gap {
  id!: string;
  topicId!: string;
  text!: string;
  severity!: 'critical' | 'high' | 'medium';
  status!: 'open' | 'addressing' | 'closing' | 'closed';
  ownerId!: string;
  questionIds!: string[];
}

export class WorkBudgetDto {
  allocated!: number;
  spent!: number;
}

export class WorkDto implements M.Work {
  id!: string;
  topicId!: string;
  title!: string;
  status!: 'planning' | 'active' | 'blocked' | 'review' | 'complete';
  leadId!: string;
  memberIds!: string[];
  progress!: number;
  /** YYYY-MM-DD */
  due!: string;
  budget!: WorkBudgetDto;
  fte!: number;
  gapIds!: string[];
  note!: string;
}

export class PaperFeedbackDto implements M.PaperFeedback {
  type!: string;
  who!: string;
  sentiment!: string;
  text!: string;
  date!: string;
}

export class PaperDto implements M.Paper {
  id!: string;
  topicId!: string;
  title!: string;
  venue!: string;
  /** YYYY-MM-DD */
  published!: string;
  authorIds!: string[];
  /** Outside labs the paper was written with; empty for unilateral work. */
  partners!: string[];
  /** Who started a joint paper: one of `partners` when a partner lab came to us; null when we did, and for unilateral work. */
  initiatedBy!: string | null;
  questionIds!: string[];
  gapIds!: string[];
  workIds!: string[];
  grade!: 'outstanding' | 'excellent' | 'satisfactory' | 'dissatisfactory' | null;
  gradedBy!: string | null;
  gradedAt!: string | null;
  feedback!: PaperFeedbackDto[];
}

export class CitationDto implements M.Citation {
  id!: string;
  paperId!: string;
  topicId!: string;
  title!: string;
  venue!: string;
  year!: number;
  org!: string;
  sector!: string;
}

export class AudienceDto {
  academic!: number;
  industry!: number;
  government!: number;
  nonprofit!: number;
}

export class GeoShareDto {
  country!: string;
  share!: number;
}

export class SplitDto {
  internal!: number;
  external!: number;
}

export class MentionsDto {
  news!: number;
  policy!: number;
  social!: number;
  patents!: number;
}

export class PaperMetricsDto implements M.PaperMetrics {
  paperId!: string;
  topicId!: string;
  /** YYYY-MM */
  month!: string;
  downloads!: number;
  views!: number;
  citations!: number;
  /** Attention score at the end of the month (a level, not an increment). */
  altmetric!: number;
  audience!: AudienceDto;
  geo!: GeoShareDto[];
  split!: SplitDto;
  mentions!: MentionsDto;
}
