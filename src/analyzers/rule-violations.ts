import type { Finding, RuleKind } from '../model/types.js';
import { ruleLoc, shortText } from './rule-util.js';
import type { Analyzer } from './types.js';

const HINT: Partial<Record<RuleKind, string>> = {
  'package-manager':
    'Kuralı dosyanın üstüne taşı veya bir PreToolUse hook ile yasak yöneticiyi engelle.',
  'forbidden-command': 'Kuralı daha net ifade et veya hook / permissions.deny ile zorunlu kıl.',
  'forbidden-path': 'Yolu permissions.deny (Edit/Write) ile koru; talimat tek başına yetmiyor.',
  'required-command': 'Komutu bir pre-commit hook ile zorunlu kıl; talimat tek başına yetmiyor.',
};

export const ruleViolations: Analyzer = {
  id: 'rule-violations',
  description: 'talimat dosyalarındaki kuralların loglarda olası ihlalleri',
  run({ audit = [] }) {
    const out: Finding[] = [];
    for (const r of audit.filter((x) => x.status === 'violated')) {
      out.push({
        ruleId: 'rule-violations',
        severity: r.violations >= 5 ? 'medium' : 'low',
        title: `"${shortText(r.rule.text)}" kuralı ${r.violations} kez çiğnenmiş olabilir (${r.triggeredSessions} oturumda)`,
        detail: `${ruleLoc(r.rule)} · ${r.rule.kind} · olası ihlal: kullanıcı açıkça istemiş olabilir`,
        wastedTokens: 0,
        wastedTokensExact: false,
        scope: { projectPath: r.rule.source.projectPath },
        evidence: r.evidence,
        suggestion:
          HINT[r.rule.kind] ??
          'Kuralı dosyanın üstüne taşı / daha net ifade et / hook ile zorunlu kıl.',
      });
    }
    return out.sort((a, b) => b.evidence.length - a.evidence.length);
  },
};
