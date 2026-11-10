import type { Finding } from '../model/types.js';
import { soleTool } from './rule-scope.js';
import { ruleLoc } from './rule-util.js';
import type { Analyzer } from './types.js';

export const staleRules: Analyzer = {
  id: 'stale-rules',
  description: 'var olmayan yol veya script’e referans veren kurallar',
  run({ audit = [] }) {
    return audit
      .filter((r) => r.status === 'stale')
      .map(
        (r): Finding => ({
          ruleId: 'stale-rules',
          severity: 'low',
          title: `Bayat kural: ${r.note ?? r.rule.text} (${ruleLoc(r.rule)})`,
          detail: r.rule.text,
          wastedTokens: r.rule.estimatedTokens * r.applicableSessions,
          wastedTokensExact: false,
          scope: { tool: soleTool(r.rule), projectPath: r.rule.source.projectPath },
          evidence: [ruleLoc(r.rule)],
          suggestion: `Satır ${r.rule.source.line}: ${r.note ?? 'referans'}; güncelle veya sil.`,
        }),
      );
  },
};
