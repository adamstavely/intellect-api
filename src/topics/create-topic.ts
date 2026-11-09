/** Pure helpers for the New Topic flow. */

import { createHash } from 'node:crypto';
import type { CreateTopicDto } from './topics.dto';

export const PRIORITY_LABEL: Record<number, string> = { 1: 'Flagship', 2: 'Core', 3: 'Core', 4: 'Emerging' };

/** US federal fiscal year containing `asOf`: October starts the next FY. */
export function fiscalYear(asOf: string): string {
  const [y, m] = asOf.split('-').map(Number);
  return `FY${String((m >= 10 ? y + 1 : y) % 100).padStart(2, '0')}`;
}

export function topicIdFor(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/, '');
  return `t-${slug || 'topic'}`;
}

/** Unique tags/sponsors, trimmed, order kept. */
export const tidy = (xs: string[] | undefined): string[] => [...new Set((xs ?? []).map((x) => x.trim()).filter(Boolean))];

/**
 * Fingerprint of a New Topic request once trimmed, de-duplicated and defaulted, so a retry under the same
 * Idempotency-Key can be told apart from a different request reusing it. The fiscal year is left as sent: its default
 * depends on the day, and a retry may come on another one.
 */
export function requestHash(body: CreateTopicDto): string {
  const canonical = {
    name: body.name.trim(),
    summary: body.summary?.trim() ?? '',
    bin: body.bin,
    priorityLabel: body.priorityLabel?.trim() || PRIORITY_LABEL[body.bin],
    priorityType: body.priorityType ?? 'internal',
    teamId: body.teamId,
    leadId: body.leadId,
    tags: tidy(body.tags),
    sponsors: tidy(body.sponsors),
    budget: { allocated: body.budget?.allocated ?? 0, fy: body.budget?.fy ?? null },
    plannedFte: body.plannedFte ?? 0,
    questions: tidy(body.questions),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** The `topic-requests` id for a user-scoped Idempotency-Key: a hash, so any key fits and none can be guessed from another. */
export const topicRequestId = (key: string): string => createHash('sha256').update(key).digest('hex');
