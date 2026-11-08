import Table from 'cli-table3';
import pc from 'picocolors';
import { fmtTokens } from '../analyzers/util.js';
import { pctChange } from '../impact/metrics.js';
import type { ChangeEvent, Comparison, PeriodMetrics } from '../model/types.js';
import { isoDay } from '../util/time.js';

const KIND: Record<ChangeEvent['kind'], string> = {
  'instructions-edited': 'talimat düzenlendi',
  'mcp-added': 'MCP eklendi',
  'mcp-removed': 'MCP kaldırıldı',
  'skill-added': 'skill eklendi',
  'skill-removed': 'skill kaldırıldı',
  'fix-applied': 'fix uygulandı',
  'manual-baseline': 'baseline',
};

const table = (head: string[]) =>
  new Table({ head: head.map((h) => pc.bold(h)), style: { head: [], border: ['grey'] } });

export const fmtPct = (p: number | undefined): string =>
  p === undefined ? '-' : `${p > 0 ? '+' : p < 0 ? '−' : '±'}%${Math.abs(Math.round(p))}`;

const label = (e: ChangeEvent) => (e.path ? (e.path.split('/').pop() ?? e.path) : KIND[e.kind]);

const ago = (at: Date, until: Date) => {
  const d = Math.round((until.getTime() - at.getTime()) / 86_400_000);
  return d <= 0 ? 'bugün' : `${d} gün önce`;
};

// scan çıktısının son satırı; veri yetersizse gösterilmez
export function impactLine(c: Comparison | undefined, until: string): string | null {
  if (!c?.sufficientData) return null;
  const p = pctChange(c.before.avgInput, c.after.avgInput);
  if (p === undefined) return null;
  return `Son değişiklikten (${label(c.event)}, ${ago(c.event.at, new Date(until))}) bu yana: oturum başına input ${fmtPct(p)} (n=${c.after.sessions})`;
}

export function renderEvents(events: ChangeEvent[]): string {
  if (!events.length) return 'Değişiklik olayı bulunamadı.';
  const t = table(['#', 'Tarih', 'Tür', 'Kaynak', 'Açıklama']);
  events.forEach((e, i) => {
    t.push([i + 1, isoDay(e.at), KIND[e.kind], e.source, e.description]);
  });
  return [
    pc.bold('Tespit edilen değişiklik olayları'),
    t.toString(),
    pc.dim('Karşılaştırma: tokenscope compare --since <#|tarih>'),
  ].join('\n');
}

const row = (name: string, b: number, a: number, fmt: (n: number) => string = fmtTokens) => [
  name,
  fmt(b),
  fmt(a),
  fmtPct(pctChange(b, a)),
];

export function renderCompare(c: Comparison): string {
  const out = [
    pc.bold(`Önce/sonra: ${c.event.description}`),
    pc.dim(`Olay: ${isoDay(c.event.at)} · ${KIND[c.event.kind]} · kaynak ${c.event.source}`),
    '',
  ];
  if (!c.sufficientData) {
    out.push(
      pc.yellow(
        `Henüz yeterli veri yok (önce ${c.before.sessions}/${c.minSessions}, sonra ${c.after.sessions}/${c.minSessions} oturum).`,
      ),
    );
    return out.join('\n');
  }
  const b: PeriodMetrics = c.before;
  const a: PeriodMetrics = c.after;
  const t = table([
    'Metrik (oturum başına)',
    `Önce (n=${b.sessions})`,
    `Sonra (n=${a.sessions})`,
    'Değişim',
  ]);
  t.push(
    row('Input ortalama', b.avgInput, a.avgInput),
    row('Input medyan', b.medianInput, a.medianInput),
    row('Output ortalama', b.avgOutput, a.avgOutput),
    row('Cache okuma ortalama', b.avgCacheRead, a.avgCacheRead),
    row('Statik bağlam', b.avgStaticContext, a.avgStaticContext),
    row('Tool çağrısı / tur', b.avgToolCallsPerTurn, a.avgToolCallsPerTurn, (n) => n.toFixed(2)),
  );
  if (b.ruleViolationRate !== undefined && a.ruleViolationRate !== undefined)
    t.push(
      row('Kural ihlali / oturum', b.ruleViolationRate, a.ruleViolationRate, (n) => n.toFixed(2)),
    );
  for (const id of [
    ...new Set([...Object.keys(b.findingCounts), ...Object.keys(a.findingCounts)]),
  ].sort())
    t.push(row(`Bulgu: ${id}`, b.findingCounts[id] ?? 0, a.findingCounts[id] ?? 0, String));
  out.push(
    t.toString(),
    pc.dim('Not: oturumlar iş türüne göre çok değişir; bu bir korelasyondur, nedensellik değil.'),
    pc.dim('Ortalama ile medyan çok ayrışıyorsa uç oturumlar sonucu çarpıtıyor olabilir.'),
  );
  return out.join('\n');
}
