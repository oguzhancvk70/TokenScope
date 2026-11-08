import { basename } from 'node:path';
import type { Finding } from '../model/types.js';
import type { Analyzer } from './types.js';
import { fmtTokens, projectName, severityFor } from './util.js';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export const repeatedReads: Analyzer = {
  id: 'repeated-reads',
  description: 'Aynı dosyanın aynı oturumda değişmeden tekrar tekrar okunması',
  run(ctx) {
    const min = ctx.thresholds.repeatedReadsMin;
    const agg = new Map<
      string,
      {
        sessions: Set<string>;
        projects: Set<string>;
        maxReads: number;
        redundant: number;
        streaks: number;
      }
    >();

    for (const s of ctx.sessions) {
      const open = new Map<string, { path: string; reads: number; redundant: number }>();
      const close = (key: string) => {
        const e = open.get(key);
        open.delete(key);
        if (!e || e.reads < min) return;
        const a = agg.get(e.path) ?? {
          sessions: new Set(),
          projects: new Set(),
          maxReads: 0,
          redundant: 0,
          streaks: 0,
        };
        a.sessions.add(s.id);
        a.projects.add(s.projectPath);
        a.maxReads = Math.max(a.maxReads, e.reads);
        a.redundant += e.redundant;
        a.streaks++;
        agg.set(e.path, a);
      };
      for (const t of s.turns) {
        for (const c of t.toolCalls) {
          if (!c.target) continue;
          if (c.name === 'Read' && !c.isError) {
            const key = `${c.target}|${c.range ?? ''}`;
            const e = open.get(key) ?? { path: c.target, reads: 0, redundant: 0 };
            if (e.reads > 0) e.redundant += c.outputTokensEstimate;
            e.reads++;
            open.set(key, e);
          } else if (WRITE_TOOLS.has(c.name)) {
            for (const key of [...open.keys()]) if (key.startsWith(`${c.target}|`)) close(key);
          }
        }
      }
      for (const key of [...open.keys()]) close(key);
    }

    return [...agg.entries()].map<Finding>(([path, a]) => ({
      ruleId: 'repeated-reads',
      severity: severityFor(a.redundant),
      title: `\`${basename(path)}\` bir oturumda ${a.maxReads} kez okundu (${a.sessions.size} oturum)`,
      detail: `${path} arada değişmeden tekrar okundu; gereksiz okumalar ~${fmtTokens(a.redundant)} token.`,
      wastedTokens: a.redundant,
      wastedTokensExact: false,
      scope: a.projects.size === 1 ? { projectPath: [...a.projects][0] } : {},
      evidence: [path, ...[...a.projects].slice(0, 3).map(projectName)],
      suggestion:
        "Dosyayı böl veya CLAUDE.md'ye kısa bir özet/harita ekle; gerekiyorsa offset/limit ile tek seferde ilgili aralığı oku.",
    }));
  },
};
