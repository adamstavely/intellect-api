import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

/**
 * Shapes of the design prototype's `data.js` (seed/data.js, extracted from
 * scaling-doodle/claude-design/Intellect (standalone).html). Only the fields the seed reads.
 */
export interface ProtoPerson {
  id: string;
  name: string;
  init: string;
  role: string;
  title: 'Chief' | 'PI' | 'Staff' | 'Postdoc';
  team: string;
  alloc?: [string, number][];
  cap?: number;
}

export interface ProtoTopic {
  id: string;
  bin: 1 | 2 | 3 | 4;
  name: string;
  lead: string;
  team: string;
  priority: string;
  summary: string;
  tags: string[];
  sponsors: string[];
  budget: { allocated: number; spent: number; fy: string };
  fte: number;
}

export interface ProtoQuestion {
  id: string;
  topic: string;
  text: string;
  status: 'open' | 'partially' | 'answered';
  owner: string;
  gaps: string[];
}

export interface ProtoGap {
  id: string;
  topic: string;
  text: string;
  severity: 'critical' | 'high' | 'medium';
  status: 'open' | 'addressing' | 'closing' | 'closed';
  work: string[];
  owner: string;
}

export interface ProtoWork {
  id: string;
  topic: string;
  title: string;
  status: 'planning' | 'active' | 'blocked' | 'review' | 'complete';
  lead: string;
  team: string[];
  progress: number;
  due: string;
  gaps: string[];
  papers: string[];
  note: string;
  budget: { allocated: number; spent: number };
  fte: number;
}

export interface ProtoPaper {
  id: string;
  topic: string;
  title: string;
  venue: string;
  year: number;
  month: string;
  authors: string[];
  /** Outside labs the paper was written with; absent for unilateral work. */
  partners?: string[];
  /** The partner lab that started a joint paper; absent when we did. */
  initiatedBy?: string;
  addresses: string[];
  gaps: string[];
  reads: { downloads: number; views: number; citations: number; altmetric: number };
  readTrend: number[];
  audience: { academic: number; industry: number; government: number; nonprofit: number };
  geo: [string, number][];
  split: { internal: number; external: number };
  mentions: { news: number; policy: number; social: number; patents: number };
  feedback: { type: string; who: string; sentiment: string; text: string; date: string }[];
  citedBy: { id: string; title: string; venue: string; year: number; org: string; sector: string }[];
}

export interface ProtoSubLab {
  id: string;
  name: string;
  short: string;
  code: string;
  lead: string;
  teams: string[];
  focus: string;
}

export interface PrototypeData {
  people: Record<string, ProtoPerson>;
  topics: ProtoTopic[];
  questions: ProtoQuestion[];
  gaps: ProtoGap[];
  work: ProtoWork[];
  papers: ProtoPaper[];
  subLabs: ProtoSubLab[];
}

export const DEFAULT_PROTOTYPE_PATH = join(__dirname, '..', '..', 'seed', 'data.js');

/**
 * Evaluates the prototype's data.js in an isolated context (it assigns `window.DATA`). The file is
 * our own checked-in seed source, not user input.
 */
export function loadPrototype(path = DEFAULT_PROTOTYPE_PATH): PrototypeData {
  const sandbox: { window: { DATA?: PrototypeData } } = { window: {} };
  runInNewContext(readFileSync(path, 'utf8'), sandbox, { filename: path, timeout: 1000 });
  if (!sandbox.window.DATA) throw new Error(`${path} did not set window.DATA`);
  // Round-trip through JSON so objects carry this realm's prototypes (matters for deep equality).
  return JSON.parse(JSON.stringify(sandbox.window.DATA)) as PrototypeData;
}
