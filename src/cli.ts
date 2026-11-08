import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { loadThresholds } from './config.js';
import { CLI_NAME, DEFAULT_SINCE, VERSION } from './constants.js';
import { saveBaseline } from './impact/baseline-store.js';
import { compareEvent, latestComparable } from './impact/compare.js';
import { periodMetrics } from './impact/metrics.js';
import type { ChangeEvent } from './model/types.js';
import { renderAudit } from './report/audit.js';
import { renderCompare, renderEvents } from './report/impact.js';
import { toJson } from './report/json.js';
import { renderInventory, renderScan, setTildeHome } from './report/terminal.js';
import { runScan } from './scan.js';
import { parseSince } from './util/time.js';

interface ScanOpts {
  since?: Date;
  all?: boolean;
  project?: string;
  tool?: string;
  json: boolean;
  redact: boolean;
  config?: string;
  top: number;
  withJscpd?: boolean;
}

const positiveInt = (v: string) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('Pozitif tam sayı olmalı.');
  return n;
};

const warn = (msg: string) => console.error(pc.yellow(`⚠ ${msg}`));

async function scanAction(opts: ScanOpts, analyze: boolean) {
  const home = homedir();
  setTildeHome(home);
  const result = await runScan({
    since: opts.all ? undefined : (opts.since ?? parseSince(DEFAULT_SINCE)),
    project: opts.project,
    tool: opts.tool,
    redact: opts.redact,
    thresholds: await loadThresholds(opts.config),
    analyze,
    withJscpd: opts.withJscpd,
    warn,
  });
  if (opts.json) {
    process.stdout.write(`${toJson(result, home, { includeInventory: true })}\n`);
  } else {
    console.log(analyze ? renderScan(result, { top: opts.top }) : renderInventory(result));
  }
}

const withScanOptions = (cmd: Command) =>
  cmd
    .option(
      '--since <duration>',
      `zaman aralığı: 30d, 12h, 2w veya ISO tarih (varsayılan ${DEFAULT_SINCE})`,
      (v) => parseSince(v),
    )
    .option('--all', 'tüm zamanlar (--since yok sayılır)')
    .option('--project <path>', 'tek projeyle sınırla')
    .option('--tool <id>', 'tek araçla sınırla (claude-code, codex, ...)')
    .option('--json', 'makine okunur çıktı', false)
    .option('--no-redact', 'komut hedeflerini kısaltmadan göster (secret maskeleme yine açık)')
    .option('--config <file>', 'eşik değerleri (JSON)');

const program = new Command()
  .name(CLI_NAME)
  .description('AI kodlama araçları için yerel token kullanım ve israf analizi. Ağ çağrısı yapmaz.')
  .version(VERSION);

withScanOptions(
  program.command('scan', { isDefault: true }).description('envanter + analiz + terminal özeti'),
)
  .option('--top <n>', 'gösterilecek bulgu sayısı', positiveInt, 5)
  .option('--with-jscpd', 'jscpd kuruluysa çalıştırıp tekrar kod verisini rapora kat')
  .action((opts: ScanOpts) => scanAction(opts, true));

const json = (v: unknown, home: string) => {
  const prefix = `${home}/`;
  return JSON.stringify(
    v,
    (_k, x) => (typeof x === 'string' && x.includes(prefix) ? x.split(prefix).join('~/') : x),
    2,
  );
};

async function load(opts: ScanOpts, extras: boolean, allTime = false) {
  const home = homedir();
  setTildeHome(home);
  const thresholds = await loadThresholds(opts.config);
  const result = await runScan({
    since: opts.all || allTime ? undefined : (opts.since ?? parseSince(DEFAULT_SINCE)),
    project: opts.project,
    tool: opts.tool,
    redact: opts.redact,
    thresholds,
    extras,
    warn,
  });
  return { home, thresholds, result };
}

withScanOptions(
  program.command('audit').description('talimat dosyalarındaki kurallara uyum denetimi'),
)
  .option('--all-rules', 'güncel referansları ve denetlenemeyen tüm satırları listele')
  .action(async (opts: ScanOpts & { allRules?: boolean }) => {
    const { home, result } = await load(opts, false);
    if (opts.json) {
      process.stdout.write(
        `${json({ audit: result.audit, findings: result.findings.filter((f) => ['rule-violations', 'stale-rules', 'dead-rules', 'conflicting-rules'].includes(f.ruleId)) }, home)}\n`,
      );
      return;
    }
    console.log(renderAudit(result.audit, result.findings, { all: !!opts.allRules }));
  });

withScanOptions(
  program.command('events').description('talimat / MCP / skill değişiklik olayları'),
).action(async (opts: ScanOpts) => {
  const { home, result } = await load(opts, true, !opts.since);
  if (opts.json) process.stdout.write(`${json(result.events, home)}\n`);
  else console.log(renderEvents(result.events));
});

withScanOptions(
  program.command('baseline').description("şu anki metriklerin snapshot'ı (~/.tokenscope)"),
)
  .option('--note <text>', 'snapshot açıklaması')
  .action(async (opts: ScanOpts & { note?: string }) => {
    const { home, result } = await load(opts, false);
    const now = new Date();
    const since = opts.all ? new Date(0) : (opts.since ?? parseSince(DEFAULT_SINCE));
    const items = result.inventory.tools.flatMap((t) => t.contextItems);
    const project = opts.project ? resolve(opts.project.replace(/^~(?=\/|$)/, home)) : undefined;
    const file = await saveBaseline(home, {
      version: 1,
      at: now.toISOString(),
      kind: 'manual-baseline',
      projectPath: project,
      description: opts.note ?? 'elle alınan baseline',
      metrics: periodMetrics(result.sessions, since, now, result.findings),
      mcpServers: [
        ...new Set(items.filter((i) => i.kind === 'mcp-server').map((i) => i.name)),
      ].sort(),
      skills: [...new Set(items.filter((i) => i.kind === 'skill').map((i) => i.name))].sort(),
      instructionTokens: Object.fromEntries(
        items.filter((i) => i.kind === 'instructions-file').map((i) => [i.name, i.estimatedTokens]),
      ),
    });
    console.log(
      `Baseline kaydedildi: ${file.replace(home, '~')} (${result.sessions.length} oturum)`,
    );
  });

program
  .command('compare')
  .description('bir değişiklik olayından önce/sonra karşılaştırması')
  .option(
    '--since <olay|tarih>',
    "olay no ('events' listesinden) veya tarih; varsayılan verisi yeterli son olay",
  )
  .option('--project <path>', 'tek projeyle sınırla')
  .option('--tool <id>', 'tek araçla sınırla')
  .option('--json', 'makine okunur çıktı', false)
  .option('--config <file>', 'eşik değerleri (JSON)')
  .action(async (opts: Omit<ScanOpts, 'since'> & { since?: string }) => {
    const { home, thresholds, result } = await load(
      { ...opts, since: undefined, redact: true, top: 0 },
      true,
      true,
    );
    let event: ChangeEvent | undefined;
    if (opts.since && /^\d+$/.test(opts.since)) {
      event = result.events[Number(opts.since) - 1];
      if (!event) throw new Error(`Olay #${opts.since} yok (${CLI_NAME} events ile listele).`);
    } else if (opts.since) {
      const at = parseSince(opts.since);
      event = {
        at,
        kind: 'manual-baseline',
        description: `${at.toISOString().slice(0, 10)} tarihi`,
        source: 'baseline',
      };
    } else {
      event = await latestComparable(result.events, {
        inventory: result.inventory,
        sessions: result.sessions,
        thresholds,
        now: new Date(),
        home,
      });
    }
    if (!event) {
      console.log(`Değişiklik olayı yok. Bir tarih ver: ${CLI_NAME} compare --since 2026-11-01`);
      return;
    }
    const c = await compareEvent(event, {
      inventory: result.inventory,
      sessions: result.sessions,
      thresholds,
      now: new Date(),
      home,
      rules: result.audit.map((r) => r.rule),
      withFindings: true,
    });
    console.log(opts.json ? json(c, home) : renderCompare(c));
  });

withScanOptions(
  program.command('inventory').description('kurulu araçlar, skill, MCP, plugin ve statik yük'),
).action((opts: ScanOpts) => scanAction({ ...opts, top: 0 }, false));

program
  .command('report')
  .description('(v0.2) HTML rapor')
  .option('--html <file>', 'çıktı dosyası')
  .action(() => {
    console.error(`${CLI_NAME} report: v0.2'de gelecek. Şimdilik: ${CLI_NAME} scan --json`);
    process.exitCode = 1;
  });

program
  .command('fix')
  .description('(v0.3) diff göster, onayla uygula')
  .option('--rule <id>', 'sadece bu kural')
  .action(() => {
    console.error(`${CLI_NAME} fix: v0.3'te gelecek. Hiçbir dosya değiştirilmedi.`);
    process.exitCode = 1;
  });

try {
  await program.parseAsync();
} catch (e) {
  console.error(pc.red(`${CLI_NAME}: ${(e as Error).message}`));
  process.exitCode = 1;
}
