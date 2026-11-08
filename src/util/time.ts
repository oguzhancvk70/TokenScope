import { InvalidArgumentError } from 'commander';

const UNIT_MS = { h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

export function parseSince(value: string, now = new Date()): Date {
  const m = /^(\d+)([dhw])$/.exec(value.trim());
  if (m) return new Date(now.getTime() - Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS]);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new InvalidArgumentError('Use a duration like 30d / 12h / 2w or an ISO date.');
  }
  return d;
}

export const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * UNIT_MS.d);

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
