import { basename, dirname, join } from 'node:path';
import fg from 'fast-glob';
import type { ContextItem } from '../model/types.js';
import { arr, isDir, isObj, readJson, str } from '../util/fs.js';
import { fileItem, mcpItems, SCAN_IGNORE, skillItem } from './claude-code.js';

export const geminiDir = (home: string): string => join(home, '.gemini');
export const geminiInstalled = (home: string): Promise<boolean> => isDir(geminiDir(home));

// settings.json → context.fileName (string | string[]), varsayılan GEMINI.md
export function contextFileNames(settings: unknown): string[] {
  const ctx = isObj(settings) && isObj(settings.context) ? settings.context : {};
  const v = ctx.fileName;
  const names =
    typeof v === 'string' ? [v] : arr(v).filter((x): x is string => typeof x === 'string');
  return names.length ? names : ['GEMINI.md'];
}

export async function geminiMcpNames(home: string, projectPaths: string[] = []): Promise<string[]> {
  const names = new Set<string>();
  for (const p of [
    join(geminiDir(home), 'settings.json'),
    ...projectPaths.map((d) => join(d, '.gemini', 'settings.json')),
  ]) {
    const s = await readJson(p);
    if (isObj(s) && isObj(s.mcpServers)) for (const n of Object.keys(s.mcpServers)) names.add(n);
  }
  for (const e of await extensionManifests(home)) for (const n of Object.keys(e.mcp)) names.add(n);
  return [...names];
}

async function skillsIn(dir: string, scope: 'global' | 'project', extra: Partial<ContextItem>) {
  if (!(await isDir(dir))) return [];
  const out: ContextItem[] = [];
  for (const md of await fg('**/SKILL.md', { cwd: dir, absolute: true, dot: true, deep: 5 })) {
    const it = await skillItem(md, scope, extra);
    if (it) out.push(it);
  }
  return out;
}

interface Extension {
  name: string;
  path: string;
  dir: string;
  mcp: Record<string, unknown>;
  contextFiles: string[];
}

async function extensionManifests(home: string): Promise<Extension[]> {
  const dir = join(geminiDir(home), 'extensions');
  if (!(await isDir(dir))) return [];
  const out: Extension[] = [];
  for (const m of await fg('*/gemini-extension.json', { cwd: dir, absolute: true })) {
    const j = await readJson(m);
    if (!isObj(j)) continue;
    const cf = j.contextFileName;
    out.push({
      name: str(j.name) ?? basename(dirname(m)),
      path: m,
      dir: dirname(m),
      mcp: isObj(j.mcpServers) ? j.mcpServers : {},
      contextFiles:
        typeof cf === 'string' ? [cf] : arr(cf).filter((x): x is string => typeof x === 'string'),
    });
  }
  return out;
}

export async function discoverGeminiContext(
  home: string,
  projectPaths: string[],
): Promise<ContextItem[]> {
  const dir = geminiDir(home);
  const settingsPath = join(dir, 'settings.json');
  const settings = await readJson(settingsPath);
  const files = contextFileNames(settings);
  const items: ContextItem[] = [];
  const add = (it: ContextItem | null) => it && items.push(it);

  for (const f of files)
    add(await fileItem('instructions-file', join(dir, f), 'global', { name: `~/.gemini/${f}` }));
  items.push(...(await skillsIn(join(dir, 'skills'), 'global', {})));
  if (isObj(settings)) items.push(...mcpItems(settings.mcpServers, settingsPath, 'global'));

  // extension'lar: plugin + bağlam dosyası + MCP
  for (const e of await extensionManifests(home)) {
    const ctxFiles = e.contextFiles.length ? e.contextFiles : ['GEMINI.md'];
    const parts: ContextItem[] = [];
    for (const f of ctxFiles) {
      const it = await fileItem('instructions-file', join(e.dir, f), 'global', { plugin: e.name });
      if (it) parts.push(it);
    }
    parts.push(...(await skillsIn(join(e.dir, 'skills'), 'global', { plugin: e.name })));
    parts.push(...mcpItems(e.mcp, e.path, 'global', { plugin: e.name }));
    items.push(
      {
        kind: 'plugin',
        name: e.name,
        path: e.path,
        scope: 'global',
        estimatedTokens: parts.reduce((n, i) => n + i.estimatedTokens, 0),
        estimateSource: 'file',
      },
      ...parts,
    );
  }

  for (const p of projectPaths) {
    if (p === home || !(await isDir(p))) continue;
    const extra = { projectPath: p };
    const ctx = await fg(
      files.map((f) => `**/${f}`),
      {
        cwd: p,
        absolute: true,
        deep: 4,
        ignore: SCAN_IGNORE,
        suppressErrors: true,
      },
    );
    for (const f of ctx.sort()) add(await fileItem('instructions-file', f, 'project', extra));
    items.push(...(await skillsIn(join(p, '.gemini', 'skills'), 'project', extra)));
    const ps = join(p, '.gemini', 'settings.json');
    const pj = await readJson(ps);
    if (isObj(pj)) items.push(...mcpItems(pj.mcpServers, ps, 'project', extra));
  }
  return items;
}
