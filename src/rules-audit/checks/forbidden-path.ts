import { homeRel } from '../../util/redact.js';
import { type Check, calls, EDIT_TOOLS, MAX_EVIDENCE, ref } from './types.js';

const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');

export const checkForbiddenPath: Check = async (rule, ctx) => {
  const wanted = norm(rule.params.path ?? '');
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  if (!wanted) return { ...out, untestable: 'yol çözümlenemedi' };
  const root = rule.source.projectPath ? homeRel(rule.source.projectPath) : undefined;
  for (const s of ctx.sessions) {
    let hit = false;
    const base = root ?? homeRel(s.projectPath);
    for (const [t, c] of calls(s)) {
      if (!EDIT_TOOLS.has(c.name) || !c.target) continue;
      hit = true;
      const rel =
        base && c.target.startsWith(`${base}/`) ? c.target.slice(base.length + 1) : c.target;
      const target = norm(rel);
      if (target === wanted || target.startsWith(`${wanted}/`) || c.target.startsWith(wanted)) {
        out.violations++;
        if (out.evidence.length < MAX_EVIDENCE) out.evidence.push(ref(s, t, `${c.name} ${rel}`));
      }
    }
    if (hit) out.triggered++;
  }
  return out;
};
