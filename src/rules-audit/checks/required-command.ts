import { summarizeCommand } from '../../util/redact.js';
import { type Check, calls, commandsOf, MAX_EVIDENCE, matchesCommand, ref } from './types.js';

// tetikleyiciden (git commit/push) önce, önceki tetikleyiciden sonra komut çalışmış mı
export const checkRequiredCommand: Check = async (rule, ctx) => {
  const wanted = summarizeCommand(rule.params.command ?? '', true);
  const trigger = `git ${rule.params.before ?? 'commit'}`;
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  if (!wanted) return { ...out, untestable: 'komut çözümlenemedi' };
  for (const s of ctx.sessions) {
    let ran = false;
    let hit = false;
    for (const [t, c] of calls(s)) {
      for (const cmd of commandsOf(c)) {
        if (matchesCommand(cmd, wanted)) ran = true;
        else if (matchesCommand(cmd, trigger)) {
          hit = true;
          if (!ran) {
            out.violations++;
            if (out.evidence.length < MAX_EVIDENCE)
              out.evidence.push(ref(s, t, `${cmd} (öncesinde ${wanted} yok)`));
          }
          ran = false;
        }
      }
    }
    if (hit) out.triggered++;
  }
  return out;
};
