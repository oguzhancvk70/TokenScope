import type { Finding, ToolCall } from '../model/types.js';
import { estimateTokens } from '../tokens/estimate.js';
import type { Analyzer } from './types.js';
import { fmtTokens, projectName, severityFor } from './util.js';

function suggestionFor(c: ToolCall): string {
  if (c.name === 'Bash')
    return 'Aynı komutu tekrar koşmadan önce ortam/bağımlılık sorununu çöz; hatayı bir kez ayrıntılı incele.';
  if (c.name === 'Edit' || c.name === 'MultiEdit')
    return "Edit eşleşmesi tutmuyor: dosyayı yeniden okuyup old_string'i daralt veya Write ile yeniden yaz.";
  if (c.name === 'Read') return 'Yol hatalı olabilir; önce Glob ile doğrula.';
  return 'Aynı çağrıyı tekrarlamadan önce hatanın nedenini düzelt.';
}

export const errorLoops: Analyzer = {
  id: 'error-loops',
  description: 'Art arda hata verip yeniden denenen çağrılar',
  run(ctx) {
    const min = ctx.thresholds.errorLoopMin;
    const agg = new Map<
      string,
      {
        sample: ToolCall;
        loops: number;
        maxRun: number;
        tokens: number;
        sessions: Set<string>;
        projects: Set<string>;
      }
    >();

    for (const s of ctx.sessions) {
      const streaks = new Map<string, { sample: ToolCall; n: number; tokens: number }>();
      const close = (key: string) => {
        const st = streaks.get(key);
        streaks.delete(key);
        if (!st || st.n < min) return;
        const a = agg.get(key) ?? {
          sample: st.sample,
          loops: 0,
          maxRun: 0,
          tokens: 0,
          sessions: new Set(),
          projects: new Set(),
        };
        a.loops++;
        a.maxRun = Math.max(a.maxRun, st.n);
        a.tokens += st.tokens;
        a.sessions.add(s.id);
        a.projects.add(s.projectPath);
        agg.set(key, a);
      };
      for (const t of s.turns) {
        for (const c of t.toolCalls) {
          const key = `${c.name}|${c.target ?? ''}`;
          if (c.isError) {
            const st = streaks.get(key) ?? { sample: c, n: 0, tokens: 0 };
            st.n++;
            st.tokens += estimateTokens(c.inputSize) + c.outputTokensEstimate + t.usage.output;
            streaks.set(key, st);
          } else {
            close(key);
          }
        }
      }
      for (const key of [...streaks.keys()]) close(key);
    }

    return [...agg.values()].map<Finding>((a) => {
      const label = a.sample.target ? `${a.sample.name} \`${a.sample.target}\`` : a.sample.name;
      return {
        ruleId: 'error-loops',
        severity: severityFor(a.tokens) === 'info' ? 'low' : severityFor(a.tokens),
        title: `${label} art arda ${a.maxRun} kez hata verdi (${a.loops} döngü, ${a.sessions.size} oturum)`,
        detail: `Hatalı denemelerin girdi/çıktı + o turların üretimi ~${fmtTokens(a.tokens)} token.`,
        wastedTokens: a.tokens,
        wastedTokensExact: false,
        scope: a.projects.size === 1 ? { projectPath: [...a.projects][0] } : {},
        evidence: [...a.projects].slice(0, 5).map(projectName),
        suggestion: suggestionFor(a.sample),
      };
    });
  },
};
