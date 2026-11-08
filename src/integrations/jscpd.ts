import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DuplicationSummary } from '../model/types.js';
import { run } from '../util/exec.js';
import { arr, exists, isObj, num, readJson, str } from '../util/fs.js';
import type { Integration } from './types.js';

const REPORTS = ['report/jscpd-report.json', '.jscpd/jscpd-report.json', 'jscpd-report.json'];

export function parseJscpdReport(raw: unknown, projectPath: string): DuplicationSummary | null {
  if (!isObj(raw)) return null;
  const stats = isObj(raw.statistics) && isObj(raw.statistics.total) ? raw.statistics.total : {};
  const clones = arr(raw.duplicates)
    .filter(isObj)
    .map((d) => ({
      files: [d.firstFile, d.secondFile]
        .map((f) => (isObj(f) ? str(f.name) : undefined))
        .filter((f): f is string => !!f),
      lines: num(d.lines),
      tokens: num(d.tokens),
    }));
  return { source: 'jscpd', projectPath, percentage: num(stats.percentage), clones };
}

async function binary(projectPath: string): Promise<string | undefined> {
  const local = join(projectPath, 'node_modules', '.bin', 'jscpd');
  if (await exists(local)) return local;
  const found = await run('which', ['jscpd']);
  return found?.trim() || undefined;
}

async function existingReport(projectPath: string): Promise<string | undefined> {
  for (const r of REPORTS) if (await exists(join(projectPath, r))) return join(projectPath, r);
  return undefined;
}

// allowRun: --with-jscpd; rapor proje dizinine değil geçici dizine yazılır
export function createJscpd(allowRun: boolean): Integration<DuplicationSummary> {
  return {
    id: 'jscpd',
    async isAvailable(projectPath) {
      if (await existingReport(projectPath)) return true;
      return allowRun && !!(await binary(projectPath));
    },
    async collect(projectPath) {
      const report = await existingReport(projectPath);
      if (report) return parseJscpdReport(await readJson(report), projectPath);
      const bin = allowRun ? await binary(projectPath) : undefined;
      if (!bin) return null;
      const out = await mkdtemp(join(tmpdir(), 'tokenscope-jscpd-'));
      try {
        const cfg = (await exists(join(projectPath, '.jscpd.json')))
          ? ['--config', '.jscpd.json']
          : [];
        await run(
          bin,
          [...cfg, '--reporters', 'json', '--output', out, '--silent', '--gitignore', '.'],
          projectPath,
          120_000,
        );
        return parseJscpdReport(await readJson(join(out, 'jscpd-report.json')), projectPath);
      } finally {
        await rm(out, { recursive: true, force: true });
      }
    },
  };
}
