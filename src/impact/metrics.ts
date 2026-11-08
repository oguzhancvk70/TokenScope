import { mainSessions } from '../analyzers/util.js';
import type { Finding, PeriodMetrics, Session } from '../model/types.js';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const sum = (s: Session, f: (u: Session['turns'][number]['usage']) => number) =>
  s.turns.reduce((n, t) => n + f(t.usage), 0);

export function periodMetrics(
  sessions: Session[],
  from: Date,
  to: Date,
  findings: Finding[] = [],
  violations?: number,
): PeriodMetrics {
  const main = mainSessions(sessions);
  const inputs = main.map((s) => sum(s, (u) => u.input));
  const turns = main.reduce((n, s) => n + s.turns.length, 0);
  const calls = main.reduce((n, s) => n + s.turns.reduce((m, t) => m + t.toolCalls.length, 0), 0);
  const findingCounts: Record<string, number> = {};
  for (const f of findings) findingCounts[f.ruleId] = (findingCounts[f.ruleId] ?? 0) + 1;
  return {
    from,
    to,
    sessions: main.length,
    avgInput: avg(inputs),
    medianInput: median(inputs),
    avgOutput: avg(main.map((s) => sum(s, (u) => u.output))),
    avgCacheRead: avg(main.map((s) => sum(s, (u) => u.cacheRead))),
    avgStaticContext: avg(
      main.map((s) => s.contextSnapshot.reduce((n, i) => n + i.estimatedTokens, 0)),
    ),
    avgToolCallsPerTurn: turns ? calls / turns : 0,
    findingCounts,
    ...(violations !== undefined && main.length
      ? { ruleViolationRate: violations / main.length }
      : {}),
  };
}

export const pctChange = (before: number, after: number): number | undefined =>
  before > 0 ? ((after - before) / before) * 100 : undefined;
