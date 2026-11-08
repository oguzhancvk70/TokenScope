import { summarizeCommand } from '../../util/redact.js';
import { type Check, calls, commandsOf, MAX_EVIDENCE, matchesCommand, ref } from './types.js';

export const checkForbiddenCommand: Check = async (rule, ctx) => {
  const raw = (rule.params.command ?? '').replace(/\s+/g, ' ').trim();
  const wanted = summarizeCommand(raw, true);
  const out = { triggered: 0, violations: 0, evidence: [] as string[] };
  // argümanlar redaksiyonda atıldığından "git push --force" gibi kurallar ölçülemez
  if (!wanted || wanted !== raw) {
    return { ...out, untestable: 'argüman içeren komut; loglarda argümanlar tutulmuyor' };
  }
  const tool = wanted.split(' ')[0];
  for (const s of ctx.sessions) {
    let hit = false;
    for (const [t, c] of calls(s)) {
      for (const cmd of commandsOf(c)) {
        if (cmd.split(' ')[0] !== tool) continue;
        hit = true;
        if (!matchesCommand(cmd, wanted)) continue;
        out.violations++;
        if (out.evidence.length < MAX_EVIDENCE) out.evidence.push(ref(s, t, cmd));
      }
    }
    if (hit) out.triggered++;
  }
  return out;
};
