import type { Finding } from '../model/types.js';
import { homeRel } from '../util/redact.js';
import type { Analyzer } from './types.js';
import { fmtTokens, projectName, severityFor } from './util.js';

// jscpd kopyalarını içeren dosyaların loglarda okunma maliyeti
export const duplicateCode: Analyzer = {
  id: 'duplicate-code',
  description: 'tekrar eden kod içeren dosyaların okunma maliyeti (jscpd)',
  run({ duplication = [], sessions }) {
    const out: Finding[] = [];
    for (const d of duplication) {
      const files = new Set(
        d.clones
          .flatMap((c) => c.files)
          .map((f) => homeRel(f.startsWith('/') ? f : `${d.projectPath}/${f}`) ?? f),
      );
      if (!files.size) continue;
      let reads = 0;
      let tokens = 0;
      for (const s of sessions) {
        if (s.projectPath !== d.projectPath) continue;
        for (const t of s.turns)
          for (const c of t.toolCalls)
            if (c.name === 'Read' && c.target && files.has(c.target)) {
              reads++;
              tokens += c.outputTokensEstimate;
            }
      }
      if (!reads) continue;
      out.push({
        ruleId: 'duplicate-code',
        severity: severityFor(tokens),
        title: `${projectName(d.projectPath)}: kopya kod içeren ${files.size} dosya ${reads} kez okundu (~${fmtTokens(tokens)} token, tekrar %${d.percentage.toFixed(1)})`,
        detail: `jscpd: ${d.clones.length} kopya blok`,
        wastedTokens: 0,
        wastedTokensExact: false,
        scope: { projectPath: d.projectPath },
        evidence: [...files].slice(0, 10),
        suggestion: 'Kopyaları ortak modüle çıkar; ajan aynı kodu birden çok yerde okumasın.',
      });
    }
    return out;
  },
};
