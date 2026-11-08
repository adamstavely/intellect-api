import type { estypes } from '@elastic/elasticsearch';

/**
 * Every index from milestone-1 plan §1. Each one is reached through its alias (`topics`),
 * which points at a versioned index (`topics-v1`) created from an index template.
 * Changing a mapping means bumping `version`, migrating (creates the new index), reindexing,
 * and swapping the alias.
 */
export interface IndexDefinition {
  alias: string;
  version: number;
  mappings: estypes.MappingTypeMapping;
}

type Props = Record<string, estypes.MappingProperty>;

const keyword: estypes.MappingProperty = { type: 'keyword' };
const text: estypes.MappingProperty = { type: 'text' };
/** Searchable text that can also be sorted and aggregated on. */
const textWithKeyword: estypes.MappingProperty = {
  type: 'text',
  fields: { keyword: { type: 'keyword', ignore_above: 512 } },
};
const float: estypes.MappingProperty = { type: 'float' };
const integer: estypes.MappingProperty = { type: 'integer' };
const day: estypes.MappingProperty = { type: 'date', format: 'strict_date' };
const month: estypes.MappingProperty = { type: 'date', format: 'strict_year_month' };
const timestamp: estypes.MappingProperty = { type: 'date', format: 'strict_date_optional_time' };

const object = (properties: Props): estypes.MappingProperty => ({ type: 'object', properties });
const nested = (properties: Props): estypes.MappingProperty => ({ type: 'nested', properties });
const strict = (properties: Props): estypes.MappingTypeMapping => ({ dynamic: 'strict', properties });

export const INDICES: IndexDefinition[] = [
  {
    alias: 'people',
    version: 1,
    mappings: strict({
      id: keyword,
      name: textWithKeyword,
      initials: keyword,
      role: keyword,
      title: keyword,
      team: keyword,
      allocations: nested({ topicId: keyword, fte: float }),
      capacity: float,
    }),
  },
  {
    alias: 'org-units',
    version: 1,
    mappings: strict({
      id: keyword,
      kind: keyword,
      name: textWithKeyword,
      code: keyword,
      logo: { type: 'keyword', index: false },
      parentId: keyword,
      leadId: keyword,
      focus: text,
    }),
  },
  {
    alias: 'topics',
    version: 1,
    mappings: strict({
      id: keyword,
      name: textWithKeyword,
      summary: text,
      bin: { type: 'byte' },
      priorityLabel: keyword,
      healthScore: integer,
      health: keyword,
      leadId: keyword,
      teamId: keyword,
      centerId: keyword,
      tags: keyword,
      sponsors: keyword,
      budget: object({ allocated: float, spent: float, fy: keyword }),
      plannedFte: float,
      stats: object({
        questions: integer,
        gaps: integer,
        openGaps: integer,
        coverage: float,
        work: integer,
        papers: integer,
        fte: float,
        grades: object({ outstanding: integer, excellent: integer, satisfactory: integer, dissatisfactory: integer, ungraded: integer }),
        collaboration: object({ unilateral: integer, joint: integer }),
      }),
      momentum: integer,
      trend: integer,
    }),
  },
  {
    alias: 'questions',
    version: 1,
    mappings: strict({ id: keyword, topicId: keyword, text, status: keyword, ownerId: keyword }),
  },
  {
    alias: 'gaps',
    version: 1,
    mappings: strict({
      id: keyword,
      topicId: keyword,
      text,
      severity: keyword,
      status: keyword,
      ownerId: keyword,
      questionIds: keyword,
    }),
  },
  {
    alias: 'work',
    version: 1,
    mappings: strict({
      id: keyword,
      topicId: keyword,
      title: textWithKeyword,
      status: keyword,
      leadId: keyword,
      memberIds: keyword,
      progress: float,
      due: day,
      budget: object({ allocated: float, spent: float }),
      fte: float,
      gapIds: keyword,
      note: text,
    }),
  },
  {
    alias: 'papers',
    version: 1,
    mappings: strict({
      id: keyword,
      topicId: keyword,
      title: textWithKeyword,
      venue: keyword,
      published: day,
      authorIds: keyword,
      partners: keyword,
      initiatedBy: keyword,
      questionIds: keyword,
      gapIds: keyword,
      workIds: keyword,
      grade: keyword,
      gradedBy: keyword,
      gradedAt: timestamp,
      feedback: nested({ type: keyword, who: keyword, sentiment: keyword, text, date: day }),
    }),
  },
  {
    alias: 'paper-metrics',
    version: 1,
    mappings: strict({
      paperId: keyword,
      topicId: keyword,
      month,
      downloads: integer,
      views: integer,
      citations: integer,
      altmetric: integer,
      audience: object({ academic: float, industry: float, government: float, nonprofit: float }),
      geo: nested({ country: keyword, share: float }),
      split: object({ internal: float, external: float }),
      mentions: object({ news: integer, policy: integer, social: integer, patents: integer }),
    }),
  },
  {
    alias: 'citations',
    version: 1,
    mappings: strict({
      id: keyword,
      paperId: keyword,
      topicId: keyword,
      title: textWithKeyword,
      venue: keyword,
      year: { type: 'short' },
      org: keyword,
      sector: keyword,
    }),
  },
  {
    // Append-only: the API only ever creates audit documents. Retention belongs to an ILM policy in production.
    alias: 'audit',
    version: 1,
    mappings: strict({
      id: keyword,
      at: timestamp,
      actor: object({ id: keyword, name: keyword, role: keyword, authenticated: { type: 'boolean' } }),
      action: keyword,
      method: keyword,
      route: keyword,
      path: { type: 'keyword', ignore_above: 2048 },
      params: { type: 'flattened' },
      query: { type: 'flattened' },
      // Kept as given, not indexed: it's evidence, not something to search on.
      body: { type: 'object', enabled: false },
      bodyTruncated: { type: 'boolean' },
      outcome: object({ status: integer, ok: { type: 'boolean' } }),
      durationMs: integer,
      ip: keyword,
      userAgent: { type: 'keyword', ignore_above: 512 },
    }),
  },
  {
    // Where audit forwarding has got to: the sort values of the last event the webhook accepted.
    alias: 'audit-cursor',
    version: 1,
    // `sort` is [epoch ms, id] exactly as Elasticsearch returned it, kept unindexed so it round-trips into search_after.
    mappings: strict({ sort: { type: 'object', enabled: false }, updatedAt: timestamp }),
  },
  {
    alias: 'topic-health-history',
    version: 1,
    mappings: strict({ topicId: keyword, month, healthScore: integer, coverage: float }),
  },
];

export const indexName = (def: IndexDefinition): string => `${def.alias}-v${def.version}`;
export const templateName = (def: IndexDefinition): string => `intellect-${def.alias}`;

export const ALIASES = {
  people: 'people',
  orgUnits: 'org-units',
  topics: 'topics',
  questions: 'questions',
  gaps: 'gaps',
  work: 'work',
  papers: 'papers',
  paperMetrics: 'paper-metrics',
  citations: 'citations',
  topicHealthHistory: 'topic-health-history',
  audit: 'audit',
  auditCursor: 'audit-cursor',
} as const;
