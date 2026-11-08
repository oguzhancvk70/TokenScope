import { join } from 'node:path';
import type {
  InstructionRule,
  Inventory,
  RuleAuditResult,
  RuleStatus,
  Session,
} from '../model/types.js';
import { exists, isObj, readJson } from '../util/fs.js';
import { CHECKS } from './checks/index.js';
import type { CheckContext } from './checks/types.js';
import { loadRules } from './extract.js';

export const appliesTo = (rule: InstructionRule, s: Session): boolean => {
  const p = rule.source.projectPath;
  if (rule.source.scope === 'global' || !p) return true;
  return s.projectPath === p || s.projectPath.startsWith(`${p}/`);
};

export async function auditRules(
  rules: InstructionRule[],
  sessions: Session[],
  home: string,
): Promise<RuleAuditResult[]> {
  const scriptCache = new Map<string, Promise<Set<string> | undefined>>();
  const scripts = (dir: string) => {
    if (!scriptCache.has(dir))
      scriptCache.set(
        dir,
        readJson(join(dir, 'package.json')).then((pkg) =>
          isObj(pkg) && isObj(pkg.scripts) ? new Set(Object.keys(pkg.scripts)) : undefined,
        ),
      );
    return scriptCache.get(dir)!;
  };
  const results: RuleAuditResult[] = [];
  for (const rule of rules) {
    const applicable = sessions.filter((s) => appliesTo(rule, s));
    const base = {
      rule,
      applicableSessions: applicable.length,
      triggeredSessions: 0,
      violations: 0,
      evidence: [] as string[],
    };
    if (rule.kind === 'unclassified') {
      results.push({ ...base, status: 'unclassified' });
      continue;
    }
    const ctx: CheckContext = { sessions: applicable, home, exists, scripts };
    const o = await CHECKS[rule.kind](rule, ctx);
    let status: RuleStatus = 'followed';
    let note = o.untestable;
    if (o.untestable) status = 'untested';
    else if (o.stale) {
      status = 'stale';
      note =
        rule.kind === 'script-reference'
          ? `\`${rule.params.script}\` script'i package.json'da yok`
          : `\`${rule.params.path}\` artık yok`;
    } else if (o.violations > 0) status = 'violated';
    else if (rule.kind !== 'path-reference' && rule.kind !== 'script-reference' && !o.triggered)
      status = 'untested';
    results.push({
      ...base,
      status,
      triggeredSessions: o.triggered,
      violations: o.violations,
      evidence: o.evidence,
      ...(note ? { note } : {}),
    });
  }
  return results;
}

export async function runAudit(
  inventory: Inventory,
  sessions: Session[],
  home: string,
): Promise<RuleAuditResult[]> {
  return auditRules(await loadRules(inventory), sessions, home);
}
