import { dirname, isAbsolute, join } from 'node:path';
import fg from 'fast-glob';
import type { Check } from './types.js';

const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

export const checkPathReference: Check = async (rule, ctx) => {
  const p = (rule.params.path ?? '').replace(/\/+$/, '');
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  const root = rule.source.projectPath;
  let candidates: string[];
  if (p.startsWith('~/')) candidates = [join(ctx.home, p.slice(2))];
  else if (isAbsolute(p)) candidates = [p];
  else if (root) candidates = [join(root, p), join(dirname(rule.source.path), p)];
  else return { ...out, untestable: 'global kuralda göreli yol; hangi projeye ait bilinmiyor' };
  for (const c of candidates) if (await ctx.exists(c)) return out;

  if (root && !p.includes('/') && !isAbsolute(p)) {
    // çıplak dosya adı: projenin herhangi bir yerinde olabilir
    const hits = await fg(`**/${p}`, { cwd: root, ignore: IGNORE, deep: 6, suppressErrors: true });
    return hits.length ? out : { ...out, stale: true };
  }
  // üst dizin de yoksa büyük olasılıkla yol değil (ör. modül adı `next/image`)
  const parents = candidates.map((c) => dirname(c));
  for (const d of parents) if (await ctx.exists(d)) return { ...out, stale: true };
  return { ...out, untestable: 'üst dizin yok; yol değil, modül adı olabilir' };
};
