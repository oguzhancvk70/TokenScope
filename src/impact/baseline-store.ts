import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChangeEventKind, PeriodMetrics } from '../model/types.js';
import { isObj, readJson } from '../util/fs.js';

export interface BaselineSnapshot {
  version: 1;
  at: string;
  kind: Extract<ChangeEventKind, 'manual-baseline' | 'fix-applied'>;
  projectPath?: string;
  description: string;
  metrics: PeriodMetrics;
  mcpServers: string[];
  skills: string[];
  instructionTokens: Record<string, number>;
}

export const baselineRoot = (home: string) => join(home, '.tokenscope', 'baselines');

export const projectHash = (projectPath?: string) =>
  createHash('sha1')
    .update(projectPath ?? '*')
    .digest('hex')
    .slice(0, 12);

// tek yazma noktası: ~/.tokenscope/baselines/<hash>/<zaman>.json (sadece sayı ve adlar)
export async function saveBaseline(home: string, snap: BaselineSnapshot): Promise<string> {
  const dir = join(baselineRoot(home), projectHash(snap.projectPath));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${snap.at.replace(/[:.]/g, '-')}.json`);
  await writeFile(file, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  return file;
}

export async function loadBaselines(
  home: string,
  projectPath?: string,
): Promise<BaselineSnapshot[]> {
  const dirs = projectPath ? [projectHash(projectPath), projectHash()] : undefined;
  const root = baselineRoot(home);
  let names: string[];
  try {
    names = dirs ?? (await readdir(root));
  } catch {
    return [];
  }
  const out: BaselineSnapshot[] = [];
  for (const d of names) {
    let files: string[];
    try {
      files = await readdir(join(root, d));
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      const s = await readJson<BaselineSnapshot>(join(root, d, f));
      if (isObj(s) && s.version === 1 && typeof s.at === 'string') out.push(s);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
