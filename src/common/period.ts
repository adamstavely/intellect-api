import { BadRequestException } from '@nestjs/common';

export interface Period {
  /** As requested, normalised: `ytd`, `FY26` or `FY26-Q2`. */
  label: string;
  /** Inclusive ISO dates. */
  from: string;
  to: string;
  /** Inclusive YYYY-MM bounds, for monthly indices. */
  fromMonth: string;
  toMonth: string;
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/**
 * Parses a reporting period. `ytd` is the calendar year to `asOf`. Fiscal years follow the US
 * federal calendar (FY26 runs 2025-10-01 to 2026-09-30; Q1 is Oct–Dec). Periods that run past
 * `asOf` end at `asOf`.
 */
export function parsePeriod(raw: string | undefined, asOf: string): Period {
  const value = (raw ?? 'ytd').trim();
  let label: string;
  let from: string;
  let to: string;

  const fy = /^FY(\d{2})(?:-Q([1-4]))?$/i.exec(value);
  if (value.toLowerCase() === 'ytd') {
    label = 'ytd';
    from = `${asOf.slice(0, 4)}-01-01`;
    to = asOf;
  } else if (fy) {
    const year = 2000 + Number(fy[1]);
    const quarter = fy[2] ? Number(fy[2]) : undefined;
    label = `FY${fy[1]}${quarter ? `-Q${quarter}` : ''}`;
    if (quarter) {
      const startMonth = 10 + (quarter - 1) * 3; // 10, 13, 16, 19 → Oct of year-1, Jan, Apr, Jul
      from = iso(year - 1, startMonth, 1);
      to = iso(year - 1, startMonth + 3, 0);
    } else {
      from = iso(year - 1, 10, 1);
      to = iso(year, 9, 30);
    }
  } else {
    throw new BadRequestException(`period must be ytd, FYyy or FYyy-Qn; got ${value}`);
  }

  if (to > asOf) to = asOf;
  if (from > to) throw new BadRequestException(`period ${label} hasn't started yet`);
  return { label, from, to, fromMonth: from.slice(0, 7), toMonth: to.slice(0, 7) };
}
