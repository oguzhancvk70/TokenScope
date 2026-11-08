import type { ContextSnapshotItem, Finding, Session, SnapshotKind } from '../model/types.js';
import type { Analyzer, AnalyzerContext } from './types.js';
import { fmtTokens, mainSessions, severityFor } from './util.js';

const SUGGESTIONS: Partial<Record<SnapshotKind, string>> = {
  'instructions-file':
    'Kısalt; nadiren gereken bölümleri alt dizin CLAUDE.md dosyalarına veya ayrı belgelere taşı.',
  'memory-file':
    'MEMORY.md indeksini kısa tut (tek satırlık işaretçiler); ayrıntı alt dosyalarda kalsın.',
  'skill-listing':
    "Kullanılmayan skill/plugin'leri kapat (bkz. dead-weight) ve uzun skill açıklamalarını kısalt.",
  'mcp-tools':
    'Sunucuyu sadece gereken projelerde etkinleştir; tool şemalarını ertelemeli (deferred) yükle.',
  'mcp-instructions':
    'MCP sunucusunun talimat bloğu her oturuma giriyor; gerekmeyen projelerde sunucuyu kapat.',
};

const LABEL: Record<SnapshotKind, string> = {
  'instructions-file': 'talimat',
  'memory-file': 'bellek',
  'skill-listing': 'skill listesi',
  'mcp-tools': 'MCP tool şemaları',
  'mcp-instructions': 'MCP talimatları',
  'builtin-tools': 'yerleşik tool tanımları',
  'system-prompt': "sistem prompt'u",
};

// logda anlık görüntü yoksa envanterden tahmin
function fallbackSnapshot(s: Session, ctx: AnalyzerContext): ContextSnapshotItem[] {
  const tool = ctx.inventory.tools.find((t) => t.id === s.tool);
  if (!tool) return [];
  const applies = (scope: string, p?: string) => scope === 'global' || p === s.projectPath;
  const out: ContextSnapshotItem[] = [];
  let skillTokens = 0;
  for (const it of tool.contextItems) {
    if (!applies(it.scope, it.projectPath) || it.onDemand) continue;
    if (it.kind === 'instructions-file' || it.kind === 'memory-file') {
      out.push({
        kind: it.kind,
        name: it.name,
        chars: it.estimatedTokens * 4,
        estimatedTokens: it.estimatedTokens,
      });
    } else if (it.kind === 'skill') {
      skillTokens += it.estimatedTokens;
    }
  }
  if (skillTokens)
    out.push({
      kind: 'skill-listing',
      name: 'skills',
      chars: skillTokens * 4,
      estimatedTokens: skillTokens,
    });
  return out;
}

export const staticContextTax: Analyzer = {
  id: 'static-context-tax',
  description: 'Her oturuma hiçbir şey yapılmadan giren sabit bağlam yükü',
  run(ctx) {
    const sessions = mainSessions(ctx.sessions);
    if (!sessions.length) return [];
    const agg = new Map<
      string,
      { kind: SnapshotKind; name: string; sessions: number; total: number }
    >();
    let measured = 0;
    for (const s of sessions) {
      const snap = s.contextSnapshot.length ? s.contextSnapshot : fallbackSnapshot(s, ctx);
      if (s.contextSnapshot.length) measured++;
      for (const it of snap) {
        const key = `${it.kind}|${it.name}`;
        const a = agg.get(key) ?? { kind: it.kind, name: it.name, sessions: 0, total: 0 };
        a.sessions++;
        a.total += it.estimatedTokens;
        agg.set(key, a);
      }
    }
    const rows = [...agg.values()].sort((a, b) => b.total - a.total);
    const grand = rows.reduce((n, r) => n + r.total, 0);
    const perSession = grand / sessions.length;
    const findings: Finding[] = [
      {
        ruleId: 'static-context-tax',
        severity: 'info',
        title: `Her oturuma ~${fmtTokens(perSession)} token sabit yük giriyor`,
        detail: `${sessions.length} oturumda toplam ~${fmtTokens(grand)} token (${measured} oturum logdan ölçüldü, kalanı envanterden tahmin).`,
        wastedTokens: 0,
        wastedTokensExact: false,
        scope: {},
        evidence: rows
          .slice(0, 8)
          .map((r) => `${LABEL[r.kind]}: ${r.name} ~${fmtTokens(r.total / r.sessions)}/oturum`),
        suggestion:
          "Aşağıdaki büyük kalemlerden başla; çoğu cache'ten okunsa da her oturumda bağlam penceresini daraltır.",
      },
    ];
    for (const r of rows) {
      const avg = r.total / r.sessions;
      const suggestion = SUGGESTIONS[r.kind];
      if (!suggestion || avg < ctx.thresholds.staticItemWarnTokens) continue;
      findings.push({
        ruleId: 'static-context-tax',
        severity: severityFor(r.total),
        title: `${r.name} (${LABEL[r.kind]}) ~${fmtTokens(avg)} token × ${r.sessions} oturum ≈ ${fmtTokens(r.total)}`,
        detail: `Bu ${LABEL[r.kind]} kalemi her oturumun başında bağlama giriyor.`,
        wastedTokens: r.total,
        wastedTokensExact: false,
        scope: {},
        evidence: [r.name],
        suggestion,
      });
    }
    return findings;
  },
};
