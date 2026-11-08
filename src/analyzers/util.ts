import { basename } from 'node:path';
import type { Severity } from '../model/types.js';

export function severityFor(tokens: number): Severity {
  if (tokens >= 1_000_000) return 'high';
  if (tokens >= 200_000) return 'medium';
  if (tokens >= 20_000) return 'low';
  return 'info';
}

export function fmtTokens(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export const fmtUSD = (n: number): string => (n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

export const projectName = (p: string | undefined): string => (p ? basename(p) || p : '-');

export const mainSessions = <T extends { isSidechain: boolean }>(s: T[]): T[] =>
  s.filter((x) => !x.isSidechain);
