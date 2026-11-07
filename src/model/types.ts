/**
 * Document shapes for every index in milestone-1 plan §1.
 * Each link is stored once, on the child; every record but people and org units carries `topicId`.
 */

export type PersonRole = 'chief' | 'pi' | 'staff' | 'postdoc';

export interface Allocation {
  topicId: string;
  fte: number;
}

export interface Person {
  id: string;
  name: string;
  initials: string;
  role: PersonRole;
  /** Job title as displayed, e.g. "Lab Director". */
  title: string;
  /** Team org-unit id; null for people outside a team (the directorate). */
  team: string | null;
  allocations: Allocation[];
  capacity: number;
}

export interface OrgUnit {
  id: string;
  kind: 'center' | 'team';
  name: string;
  code: string | null;
  parentId: string | null;
  leadId: string | null;
  focus: string | null;
}

export type HealthBand = 'healthy' | 'watch' | 'at-risk';

export interface TopicStats {
  questions: number;
  gaps: number;
  openGaps: number;
  /** Share (0–1) of open gaps with at least one `active` work item. */
  coverage: number;
  work: number;
  papers: number;
  fte: number;
  /** Paper grade roll-up: count per grade, plus papers not yet graded. */
  grades: GradeCounts;
  /** Papers done alone vs. with partner labs; the two sum to `papers`. */
  collaboration: CollaborationCounts;
}

/** Papers published in the last calendar month and so far this month. */
export interface RecentPapers {
  lastMonth: number;
  thisMonth: number;
}

export interface CollaborationCounts {
  unilateral: number;
  joint: number;
}

export interface GradeCounts {
  outstanding: number;
  excellent: number;
  satisfactory: number;
  dissatisfactory: number;
  ungraded: number;
}

export interface Topic {
  id: string;
  name: string;
  summary: string;
  bin: 1 | 2 | 3 | 4;
  priorityLabel: string;
  healthScore: number;
  health: HealthBand;
  leadId: string;
  teamId: string;
  centerId: string | null;
  tags: string[];
  sponsors: string[];
  budget: { allocated: number; spent: number; fy: string };
  /** Full-time equivalents the topic is planned to have; `stats.fte` is what people are actually allocated. */
  plannedFte: number;
  stats: TopicStats;
  momentum: number;
  trend: number[];
}

export type QuestionStatus = 'open' | 'partially' | 'answered';
export interface Question {
  id: string;
  topicId: string;
  text: string;
  status: QuestionStatus;
  ownerId: string;
}

export type GapSeverity = 'critical' | 'high' | 'medium';
export type GapStatus = 'open' | 'addressing' | 'closing' | 'closed';
export interface Gap {
  id: string;
  topicId: string;
  text: string;
  severity: GapSeverity;
  status: GapStatus;
  ownerId: string;
  questionIds: string[];
}

export type WorkStatus = 'planning' | 'active' | 'blocked' | 'review' | 'complete';
export interface Work {
  id: string;
  topicId: string;
  title: string;
  status: WorkStatus;
  leadId: string;
  memberIds: string[];
  progress: number;
  /** ISO date, YYYY-MM-DD. */
  due: string;
  budget: { allocated: number; spent: number };
  fte: number;
  gapIds: string[];
  note: string;
}

export type PaperGrade = 'outstanding' | 'excellent' | 'satisfactory' | 'dissatisfactory';
export interface PaperFeedback {
  type: string;
  who: string;
  sentiment: string;
  text: string;
  date: string;
}
export interface Paper {
  id: string;
  topicId: string;
  title: string;
  venue: string;
  /** ISO date, YYYY-MM-DD. */
  published: string;
  authorIds: string[];
  /** Outside labs the paper was written with. Empty means unilateral; any partner makes it joint. */
  partners: string[];
  questionIds: string[];
  gapIds: string[];
  workIds: string[];
  grade: PaperGrade | null;
  gradedBy: string | null;
  gradedAt: string | null;
  feedback: PaperFeedback[];
}

export interface PaperMetrics {
  paperId: string;
  topicId: string;
  /** YYYY-MM */
  month: string;
  /** Monthly increments. */
  downloads: number;
  views: number;
  citations: number;
  /** Altmetric attention score as of the end of the month (a level, not an increment). */
  altmetric: number;
  /** Percentage shares; constant across months in the seed. */
  audience: { academic: number; industry: number; government: number; nonprofit: number };
  geo: { country: string; share: number }[];
  split: { internal: number; external: number };
  /** Monthly increments. */
  mentions: { news: number; policy: number; social: number; patents: number };
}

export interface Citation {
  id: string;
  paperId: string;
  topicId: string;
  title: string;
  venue: string;
  year: number;
  org: string;
  sector: string;
}

export interface TopicHealthHistory {
  topicId: string;
  /** YYYY-MM */
  month: string;
  healthScore: number;
  coverage: number;
}
