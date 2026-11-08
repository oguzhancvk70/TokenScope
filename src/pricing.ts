import pricing from '../data/pricing.json' with { type: 'json' };
import type { TokenUsage } from './model/types.js';

export interface Rates {
  label: string;
  tier: number;
  recommend?: boolean;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  longContextThreshold?: number;
  longContextMultiplier?: number;
}

export const MODELS = pricing.models as Record<string, Rates>;
const KEYS = Object.keys(MODELS).sort((a, b) => b.length - a.length);

export function modelKey(model: string | undefined): string | undefined {
  if (!model) return undefined;
  return KEYS.find((k) => model === k || model.startsWith(`${k}-`) || model.startsWith(`${k}@`));
}

export function ratesFor(model: string | undefined): Rates | undefined {
  const key = modelKey(model);
  return key ? MODELS[key] : undefined;
}

export const recommendable = (): [string, Rates][] =>
  Object.entries(MODELS)
    .filter(([, r]) => r.recommend)
    .sort((a, b) => a[1].tier - b[1].tier);

export function costWithRates(r: Rates, u: TokenUsage): number {
  const promptTokens = u.input + u.cacheRead + u.cacheWrite;
  const m =
    r.longContextThreshold && promptTokens > r.longContextThreshold
      ? (r.longContextMultiplier ?? 1)
      : 1;
  const split = (u.cacheWrite5m ?? 0) + (u.cacheWrite1h ?? 0);
  const write =
    split > 0
      ? (u.cacheWrite5m ?? 0) * r.cacheWrite5m + (u.cacheWrite1h ?? 0) * r.cacheWrite1h
      : u.cacheWrite * r.cacheWrite5m;
  return (m * (u.input * r.input + u.output * r.output + u.cacheRead * r.cacheRead + write)) / 1e6;
}

// USD; model fiyatı bilinmiyorsa undefined ("veri yok")
export function usageCost(model: string | undefined, u: TokenUsage): number | undefined {
  const r = ratesFor(model);
  return r ? costWithRates(r, u) : undefined;
}
