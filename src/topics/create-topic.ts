/** Pure helpers for the New Topic flow. */

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
