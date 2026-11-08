import { dirname } from 'node:path';
import type { Check } from './types.js';

export const checkScriptReference: Check = async (rule, ctx) => {
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  const script = rule.params.script ?? '';
  if (!rule.source.projectPath)
    return { ...out, untestable: 'global kural; package.json bilinmiyor' };
  let found: Set<string> | undefined;
  for (const dir of [rule.source.projectPath, dirname(rule.source.path)]) {
    found = await ctx.scripts(dir);
    if (found) break;
  }
  if (!found) return { ...out, untestable: 'package.json bulunamadı' };
  return found.has(script) ? out : { ...out, stale: true };
};
