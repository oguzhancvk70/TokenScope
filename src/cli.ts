import { homedir } from 'node:os';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { loadThresholds } from './config.js';
import { CLI_NAME, DEFAULT_SINCE, VERSION } from './constants.js';
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
  .action((opts: ScanOpts) => scanAction(opts, true));

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
