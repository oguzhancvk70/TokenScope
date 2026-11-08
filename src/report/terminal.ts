import Table from 'cli-table3';
import pc from 'picocolors';
import { fmtTokens, fmtUSD, projectName } from '../analyzers/util.js';
import { CLI_NAME } from '../constants.js';
import type { ContextItem, Finding, Severity } from '../model/types.js';
import type { ScanResult } from '../scan.js';
import { isoDay } from '../util/time.js';
import { impactLine } from './impact.js';

const SEV: Record<Severity, (s: string) => string> = {
  high: (s) => pc.red(pc.bold(s)),
  medium: pc.yellow,
  low: pc.cyan,
  info: pc.dim,
};

const AUDIT_RULES = new Set(['rule-violations', 'conflicting-rules', 'stale-rules', 'dead-rules']);

const TIER = ['', 'Haiku sınıfı', 'Sonnet sınıfı', 'Opus sınıfı', 'Fable sınıfı'];

// aynı ada sahip projeler üst dizinle ayrışır
function projectLabels(paths: string[]): (p: string) => string {
  const counts = new Map<string, number>();
  for (const p of new Set(paths)) counts.set(projectName(p), (counts.get(projectName(p)) ?? 0) + 1);
  return (p) => {
    const name = projectName(p);
    if ((counts.get(name) ?? 0) < 2) return name;
    const parts = p.split('/').filter(Boolean);
    return parts.slice(-2).join('/');
  };
}

const table = (head: string[]) =>
  new Table({ head: head.map((h) => pc.bold(h)), style: { head: [], border: ['grey'] } });

function header(r: ScanResult): string[] {
  const s = r.summary;
  const range = s.since
    ? `${isoDay(new Date(s.since))} → ${isoDay(new Date(s.until))}`
    : 'tüm zamanlar';
  const tools = s.tools.length
    ? s.tools
        .map((t) =>
          t.supported ? `${t.id} (${t.sessions} oturum)` : `${t.id} (${pc.dim('veri yok')})`,
        )
        .join(', ')
    : 'hiçbir AI aracı bulunamadı';
  const cost =
    s.estCostUSD !== undefined ? `~${fmtUSD(s.estCostUSD)} tahmini maliyet` : 'maliyet: veri yok';
  const t = s.tokens;
  return [
    `${pc.bold(CLI_NAME)} · ${range} · ${tools}`,
    `Toplam ${pc.bold(fmtTokens(t.total))} token ${s.tokensExact ? '(kesin)' : '(kısmen tahmini)'} · girdi ${fmtTokens(t.input)} · çıktı ${fmtTokens(t.output)} · cache okuma ${fmtTokens(t.cacheRead)} · cache yazma ${fmtTokens(t.cacheWrite)}`,
    `${cost} · tahmini israf ${pc.bold(`~${fmtTokens(s.wastedTokens)}`)} token · sabit yük ~${fmtTokens(s.staticTokensPerSession)} token/oturum`,
  ];
}

function findingLines(f: Finding, i: number): string[] {
  const waste = f.wastedTokens > 0 ? `~${fmtTokens(f.wastedTokens)} token · ` : '';
  return [
    `${String(i + 1).padStart(2)}. ${SEV[f.severity](`[${f.severity.toUpperCase()}]`)} ${f.title}`,
    `    ${pc.dim(waste)}${f.suggestion}`,
  ];
}

export function renderScan(r: ScanResult, opts: { top: number }): string {
  const out = [...header(r), ''];
  if (!r.sessions.length) {
    out.push('Analiz edilecek oturum bulunamadı (--since aralığını genişletmeyi dene).');
    return out.join('\n');
  }

  const ranked = r.findings.filter(
    (f) => f.ruleId !== 'model-fit' && (f.wastedTokens > 0 || f.severity !== 'info'),
  );
  const overview = r.findings.find(
    (f) => f.ruleId === 'static-context-tax' && f.wastedTokens === 0,
  );
  // kural denetimi bulgusu token israfı taşımasa da listeye bir sıra ile girer
  let top = ranked.slice(0, opts.top);
  const bestAudit = ranked.find((f) => AUDIT_RULES.has(f.ruleId) && f.severity !== 'info');
  if (bestAudit && opts.top > 0 && !top.includes(bestAudit))
    top = [...top.slice(0, opts.top - 1), bestAudit];
  out.push(pc.bold(`En çok israf eden ${Math.min(opts.top, ranked.length)} bulgu`));
  if (!ranked.length) out.push(pc.dim('  Eşikleri aşan bulgu yok.'));
  for (const [i, f] of top.entries()) out.push(...findingLines(f, i));
  if (ranked.length > opts.top)
    out.push(
      pc.dim(`  +${ranked.length - opts.top} bulgu daha (--top ${ranked.length} veya --json)`),
    );
  if (overview)
    out.push(
      '',
      `${pc.bold('Sabit yük:')} ${overview.title}`,
      ...overview.evidence.slice(0, 5).map((e) => pc.dim(`  · ${e}`)),
    );

  const label = projectLabels([
    ...r.summary.projects.map((p) => p.projectPath),
    ...r.modelAdvice.map((a) => a.projectPath),
  ]);

  if (r.modelAdvice.length) {
    out.push('', pc.bold('Model önerileri (aynı işi daha uygun maliyetle bitirebilecek modeller)'));
    const t = table([
      'Proje',
      'Şu anki',
      '~Maliyet',
      'Gereken',
      'Önerilen',
      '~Tasarruf',
      'Alternatifler',
    ]);
    for (const a of r.modelAdvice.slice(0, 10)) {
      const current = a.currentModels
        .slice(0, 2)
        .map((m) => `${m.model.replace('claude-', '')} %${Math.round(m.share * 100)}`)
        .join(', ');
      const rec = a.recommended;
      const alts = a.options
        .map((o) => {
          const label = `${o.label.replace('Claude ', '')} ${fmtUSD(o.costUSD)}`;
          if (o.fit === 'recommended') return pc.green(`${label} ✓`);
          if (o.fit === 'risky') return pc.yellow(`${label} ?`);
          if (o.fit === 'current') return pc.dim(`${label} (şu an)`);
          return label;
        })
        .join(' · ');
      let saving = '-';
      if (rec && rec.savingsUSD > 0.005) saving = pc.green(fmtUSD(rec.savingsUSD));
      else if (rec && rec.savingsUSD < -0.005) saving = pc.yellow(`+${fmtUSD(-rec.savingsUSD)}`);
      t.push([
        label(a.projectPath),
        current,
        fmtUSD(a.currentCostUSD),
        TIER[a.complexity.requiredTier] ?? '-',
        rec ? rec.label.replace('Claude ', '') : '-',
        saving,
        alts,
      ]);
    }
    out.push(t.toString());
    out.push(
      pc.dim(
        '  ✓ yeterli ve en ucuz · ? riskli (bir alt sınıf) · +$ şu anki model zayıf kalıyor olabilir',
      ),
    );
    out.push(
      pc.dim(
        '  Sezgisel: bağlam boyu, düzenlenen dosya, tur sayısı, hata oranı. Aynı token kullanımı varsayılır.',
      ),
    );
  }

  out.push('', pc.bold('Araç × proje'));
  const t = table([
    'Araç',
    'Proje',
    'Oturum',
    'Girdi',
    'Çıktı',
    'Cache okuma',
    'Cache yazma',
    '~Maliyet',
    '~İsraf',
  ]);
  for (const p of r.summary.projects.slice(0, 15)) {
    t.push([
      p.tool,
      label(p.projectPath),
      p.sessions,
      fmtTokens(p.tokens.input),
      fmtTokens(p.tokens.output),
      fmtTokens(p.tokens.cacheRead),
      fmtTokens(p.tokens.cacheWrite),
      p.estCostUSD !== undefined ? fmtUSD(p.estCostUSD) : 'veri yok',
      p.wastedTokens ? fmtTokens(p.wastedTokens) : '-',
    ]);
  }
  for (const tool of r.summary.tools.filter((x) => !x.supported)) {
    t.push([tool.id, pc.dim('veri yok'), '-', '-', '-', '-', '-', '-', '-']);
  }
  out.push(t.toString());
  if (r.summary.projects.length > 15)
    out.push(pc.dim(`  +${r.summary.projects.length - 15} proje daha (--json)`));

  out.push(...footer(r));
  return out.join('\n');
}

function footer(r: ScanResult): string[] {
  const out = [
    '',
    pc.dim("Detay için --json (HTML rapor v0.2'de). ~ işaretli değerler tahminidir."),
  ];
  const impact = impactLine(r.impact, r.summary.until);
  if (impact) out.push(impact);
  const git = r.git.filter((x) => x.matched);
  if (git.length) {
    const sum = (f: (g: (typeof git)[number]) => number) => git.reduce((n, g) => n + f(g), 0);
    const high = sum((g) => g.highConfidence);
    const how = high
      ? `${high} kesin (Git AI), kalanı zaman aralığına göre`
      : 'zaman aralığına göre tahmini';
    const ratios = git.filter((g) => g.aiRewriteRatio !== undefined);
    const ai = ratios.length
      ? ` · AI satırlarının %${Math.round((sum((g) => g.aiRewriteRatio ?? 0) / ratios.length) * 100)}'i sonradan yeniden yazıldı`
      : '';
    out.push(
      pc.dim(
        `Git: ${git.length} projede ${sum((g) => g.matched)}/${sum((g) => g.commits)} commit oturumlarla eşleşti (${how})${ai}`,
      ),
    );
  }
  const missing = [
    !r.integrations.jscpd && 'tekrar kod için jscpd (`npx jscpd`, sonra --with-jscpd)',
    !r.integrations.gitAi && 'kesin AI blame için Git AI (refs/notes/ai)',
  ].filter(Boolean);
  if (missing.length && r.integrations.checked && r.sessions.length)
    out.push(pc.dim(`İpucu: ${missing.join(' · ')}`));
  const p = r.summary.parse;
  if (p.skippedLines) out.push(pc.yellow(`⚠ ${p.skippedLines} satır atlandı (bozuk/okunamayan).`));
  if (r.summary.unpricedModels.length)
    out.push(
      pc.dim(
        `Fiyatı bilinmeyen modeller (maliyete dahil değil): ${r.summary.unpricedModels.join(', ')}`,
      ),
    );
  return out;
}

function tokensCell(i: ContextItem): string {
  if (i.kind === 'hook') return '-';
  if (i.estimateSource === 'none') return pc.dim('veri yok');
  return `~${fmtTokens(i.estimatedTokens)}${i.estimateSource === 'log' ? pc.dim(' (log)') : ''}`;
}

export function renderInventory(r: ScanResult): string {
  const out = [header(r)[0] ?? '', ''];
  const tt = table(['Araç', 'Durum', 'Sürüm', 'Log yolları', 'Config']);
  for (const t of r.inventory.tools) {
    tt.push([
      t.id,
      t.supported ? pc.green('analiz edilir') : pc.dim('kurulu · veri yok (v0.2+)'),
      t.version ?? '-',
      t.logPaths.length ? t.logPaths.map(tilde).join('\n') : '-',
      t.configPaths.length ? t.configPaths.map(tilde).join('\n') : '-',
    ]);
  }
  out.push(tt.toString());

  for (const tool of r.inventory.tools.filter((t) => t.contextItems.length)) {
    out.push('', pc.bold(`${tool.id} — statik bağlam envanteri`));
    const t = table(['Tür', 'Ad', 'Kapsam', '~Token/oturum', 'Kullanım', 'Son kullanım']);
    const items = [...tool.contextItems].sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    for (const i of items) {
      const usable = i.kind === 'skill' || i.kind === 'mcp-server' || i.kind === 'plugin';
      t.push([
        i.kind + (i.onDemand ? pc.dim(' (isteğe bağlı)') : ''),
        i.name,
        i.scope === 'global' ? 'global' : projectName(i.projectPath),
        tokensCell(i),
        usable ? String(i.usageCount ?? 0) : '-',
        usable && i.lastUsedAt ? isoDay(i.lastUsedAt) : '-',
      ]);
    }
    out.push(t.toString());
    const total = items
      .filter((i) => i.scope === 'global' && !i.onDemand)
      .reduce((n, i) => n + i.estimatedTokens, 0);
    out.push(pc.dim(`Global kalemlerin toplamı ~${fmtTokens(total)} token/oturum (tahmini).`));
  }
  out.push(...footer(r).slice(2));
  return out.join('\n');
}

let homePrefix = '';
export const setTildeHome = (home: string): void => {
  homePrefix = home;
};
const tilde = (p: string) =>
  homePrefix && p.startsWith(homePrefix) ? `~${p.slice(homePrefix.length)}` : p;
