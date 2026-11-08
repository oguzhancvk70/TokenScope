import type { Finding, InstructionRule } from '../model/types.js';
import { ruleLoc, shortText } from './rule-util.js';
import type { Analyzer } from './types.js';

// iki kural aynı oturuma birlikte yüklenebilir mi
const coApplicable = (a: InstructionRule, b: InstructionRule) =>
  a.source.scope === 'global' ||
  b.source.scope === 'global' ||
  a.source.projectPath === b.source.projectPath;

const key = (r: InstructionRule) =>
  `${r.kind}|${Object.entries(r.params)
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('&')}`;

function conflictReason(a: InstructionRule, b: InstructionRule): string | null {
  const pa = a.params;
  const pb = b.params;
  if (a.kind === 'package-manager' && b.kind === 'package-manager') {
    if (pa.expected && pb.expected && pa.expected !== pb.expected)
      return `paket yöneticisi: ${pa.expected} ↔ ${pb.expected}`;
    if (pa.expected && pb.forbidden?.split(',').includes(pa.expected) && !pb.expected)
      return `${pa.expected} hem isteniyor hem yasak`;
    if (pb.expected && pa.forbidden?.split(',').includes(pb.expected) && !pa.expected)
      return `${pb.expected} hem isteniyor hem yasak`;
  }
  const cmd = (r: InstructionRule) => r.params.command?.trim();
  if (
    ((a.kind === 'forbidden-command' && b.kind === 'required-command') ||
      (a.kind === 'required-command' && b.kind === 'forbidden-command')) &&
    cmd(a) === cmd(b)
  )
    return `\`${cmd(a)}\` hem zorunlu hem yasak`;
  return null;
}

export const conflictingRules: Analyzer = {
  id: 'conflicting-rules',
  description: 'birbiriyle çelişen veya tekrar eden kurallar',
  run({ audit = [] }) {
    const rules = audit.map((r) => r.rule).filter((r) => r.kind !== 'unclassified');
    const sessionsOf = new Map(audit.map((r) => [r.rule.id, r.applicableSessions]));
    const out: Finding[] = [];
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const a = rules[i]!;
        const b = rules[j]!;
        if (!coApplicable(a, b)) continue;
        const reason = conflictReason(a, b);
        if (reason) {
          out.push({
            ruleId: 'conflicting-rules',
            severity: 'medium',
            title: `Çelişen kurallar: ${reason}`,
            detail: `${ruleLoc(a)} ↔ ${ruleLoc(b)}`,
            wastedTokens: 0,
            wastedTokensExact: false,
            scope: { projectPath: a.source.projectPath ?? b.source.projectPath },
            evidence: [`${ruleLoc(a)} ${shortText(a.text)}`, `${ruleLoc(b)} ${shortText(b.text)}`],
            suggestion: 'Birini sil; proje kuralı globali ezmeliyse bunu açıkça yaz.',
          });
        } else if (key(a) === key(b) && a.source.path !== b.source.path) {
          out.push({
            ruleId: 'conflicting-rules',
            severity: 'low',
            title: `Tekrar eden kural (${a.kind}): ${shortText(b.text)}`,
            detail: `${ruleLoc(a)} ve ${ruleLoc(b)} aynı şeyi söylüyor`,
            wastedTokens: b.estimatedTokens * (sessionsOf.get(b.id) ?? 0),
            wastedTokensExact: false,
            scope: { projectPath: b.source.projectPath },
            evidence: [ruleLoc(a), ruleLoc(b)],
            suggestion: 'Kuralı tek yerde tut (global ya da proje).',
          });
        }
      }
    }
    return out;
  },
};
