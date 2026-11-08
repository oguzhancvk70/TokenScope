import { z } from 'zod';
import { DEFAULT_THRESHOLDS, type Thresholds } from './constants.js';
import { isObj, readJson } from './util/fs.js';

const positive = z.number().positive();
const ThresholdSchema = z
  .strictObject({
    staticItemWarnTokens: positive,
    deadWeightDays: positive,
    repeatedReadsMin: z.number().int().min(2),
    hugeOutputTokens: positive,
    errorLoopMin: z.number().int().min(2),
    deadRuleMinSessions: z.number().int().min(1),
    impactMinSessions: z.number().int().min(1),
  })
  .partial();

// --config: { "thresholds": { ... } } veya düz eşik nesnesi
export async function loadThresholds(path?: string): Promise<Thresholds> {
  const base: Thresholds = { ...DEFAULT_THRESHOLDS };
  if (!path) return base;
  const raw = await readJson(path);
  if (raw === undefined) throw new Error(`Config okunamadı: ${path}`);
  const src = isObj(raw) && 'thresholds' in raw ? raw.thresholds : raw;
  const parsed = ThresholdSchema.safeParse(src);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Geçersiz config (${path}): ${msg}`);
  }
  return { ...base, ...parsed.data };
}
