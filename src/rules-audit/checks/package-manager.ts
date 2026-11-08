import { PACKAGE_MANAGERS } from '../patterns/types.js';
import { type Check, calls, commandsOf, MAX_EVIDENCE, ref } from './types.js';

export const checkPackageManager: Check = async (rule, ctx) => {
  const forbidden = new Set((rule.params.forbidden ?? '').split(',').filter(Boolean));
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  for (const s of ctx.sessions) {
    let hit = false;
    for (const [t, c] of calls(s)) {
      for (const cmd of commandsOf(c)) {
        const tool = cmd.split(' ')[0] ?? '';
        if (!PACKAGE_MANAGERS.includes(tool)) continue;
        hit = true;
        if (!forbidden.has(tool)) continue;
        out.violations++;
        if (out.evidence.length < MAX_EVIDENCE) out.evidence.push(ref(s, t, cmd));
      }
    }
    if (hit) out.triggered++;
  }
  return out;
};
