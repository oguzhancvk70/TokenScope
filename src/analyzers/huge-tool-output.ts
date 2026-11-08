import type { Finding, ToolCall } from '../model/types.js';
import type { Analyzer } from './types.js';
import { fmtTokens, projectName, severityFor } from './util.js';

function suggestionFor(c: ToolCall): string {
  if (c.name === 'Bash')
    return 'Çıktıyı kıs: `| tail -n 50`, `--silent`/`--quiet`, ya da dosyaya yazıp sadece ilgili kısmı oku.';
  if (c.name === 'Read')
    return 'Dosyayı offset/limit ile parça parça oku veya daha küçük dosyalara böl.';
  if (c.name === 'Grep' || c.name === 'Glob')
    return 'Aramayı daralt (path/glob filtresi, head_limit, files_with_matches modu).';
  if (c.isMcp) return "MCP tool'unun sayfalama/filtre parametrelerini kullan.";
  return "Bu tool'un çıktısını sınırlayan bir parametre kullan.";
}

export const hugeToolOutput: Analyzer = {
  id: 'huge-tool-output',
  description: 'Bağlama giren devasa tool çıktıları',
  run(ctx) {
    const limit = ctx.thresholds.hugeOutputTokens;
    const groups = new Map<
      string,
      {
        sample: ToolCall;
        count: number;
        total: number;
        max: number;
        sessions: Set<string>;
        projects: Set<string>;
      }
    >();
    for (const s of ctx.sessions) {
      for (const t of s.turns) {
        for (const c of t.toolCalls) {
          if (c.outputTokensEstimate <= limit) continue;
          const key = `${c.name}|${c.target ?? ''}`;
          const g = groups.get(key) ?? {
            sample: c,
            count: 0,
            total: 0,
            max: 0,
            sessions: new Set(),
            projects: new Set(),
          };
          g.count++;
          g.total += c.outputTokensEstimate;
          g.max = Math.max(g.max, c.outputTokensEstimate);
          g.sessions.add(s.id);
          g.projects.add(s.projectPath);
          groups.set(key, g);
        }
      }
    }
    return [...groups.values()].map<Finding>((g) => {
      const label = g.sample.target ? `${g.sample.name} \`${g.sample.target}\`` : g.sample.name;
      return {
        ruleId: 'huge-tool-output',
        severity: severityFor(g.total),
        title: `${label} çıktısı ~${fmtTokens(g.max)} token'a ulaştı (${g.count}×)`,
        detail: `Eşik ${fmtTokens(limit)} token; ${g.sessions.size} oturumda, toplam ~${fmtTokens(g.total)} token bağlama girdi.`,
        wastedTokens: g.total,
        wastedTokensExact: false,
        scope: g.projects.size === 1 ? { projectPath: [...g.projects][0] } : {},
        evidence: [...g.projects].slice(0, 5).map(projectName),
        suggestion: suggestionFor(g.sample),
      };
    });
  },
};
