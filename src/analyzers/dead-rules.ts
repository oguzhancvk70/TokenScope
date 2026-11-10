import type { Finding, RuleAuditResult } from '../model/types.js';
import { LOG_KINDS } from '../rules-audit/checks/index.js';
import { homeRel } from '../util/redact.js';
import { soleTool } from './rule-scope.js';
import { ruleLoc, shortText } from './rule-util.js';
import type { Analyzer } from './types.js';
import { fmtTokens } from './util.js';

export const deadRules: Analyzer = {
  id: 'dead-rules',
  description: 'çok sayıda oturumda hiç uygulanabilir olmamış kurallar',
  run({ audit = [], thresholds }) {
    const dead = audit.filter(
      (r) =>
        r.status === 'untested' &&
        !r.note &&
        LOG_KINDS.has(r.rule.kind) &&
        r.applicableSessions >= thresholds.deadRuleMinSessions,
    );
    const byFile = new Map<string, RuleAuditResult[]>();
    for (const r of dead)
      byFile.set(r.rule.source.path, [...(byFile.get(r.rule.source.path) ?? []), r]);
    const out: Finding[] = [];
    for (const [path, rs] of byFile) {
      const perSession = rs.reduce((n, r) => n + r.rule.estimatedTokens, 0);
      const sessions = Math.max(...rs.map((r) => r.applicableSessions));
      out.push({
        ruleId: 'dead-rules',
        severity: 'info',
        title: `${homeRel(path)}: ${rs.length} kural ${sessions} oturumda hiç tetiklenmedi (~${fmtTokens(perSession)} token/oturum)`,
        detail:
          'Kuralın konusu olan eylem (komut, düzenleme, commit) bu oturumlarda hiç görülmedi.',
        wastedTokens: perSession * sessions,
        wastedTokensExact: false,
        scope: { tool: soleTool(rs[0]?.rule), projectPath: rs[0]?.rule.source.projectPath },
        evidence: rs.map((r) => `${ruleLoc(r.rule)} ${shortText(r.rule.text)}`),
        suggestion: 'Gerçekten gerekli değilse kaldır veya ilgili projenin talimat dosyasına taşı.',
      });
    }
    return out;
  },
};
