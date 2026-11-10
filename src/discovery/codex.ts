import { join } from 'node:path';
import fg from 'fast-glob';
import type { ContextItem } from '../model/types.js';
import { exists, isDir, readText } from '../util/fs.js';
import { fileItem, mcpItems, SCAN_IGNORE, skillItem } from './claude-code.js';

export const codexDir = (home: string): string => join(home, '.codex');
export const codexInstalled = (home: string): Promise<boolean> => isDir(codexDir(home));

// config.toml: [mcp_servers.<ad>] ve [mcp_servers."<ad>"] başlıkları
export function tomlMcpServers(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/^\s*\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([\w-]+))\]/gm))
    names.add(m[1] ?? m[2] ?? m[3] ?? '');
  names.delete('');
  return [...names];
}

async function tomlItems(
  path: string,
  scope: 'global' | 'project',
  extra: Partial<ContextItem> = {},
): Promise<ContextItem[]> {
  const text = await readText(path);
  if (text === undefined) return [];
  return mcpItems(Object.fromEntries(tomlMcpServers(text).map((n) => [n, {}])), path, scope, extra);
}

// override varsa AGENTS.md yerine o okunur
async function agentsFile(dir: string): Promise<string | undefined> {
  for (const f of ['AGENTS.override.md', 'AGENTS.md'])
    if (await exists(join(dir, f))) return join(dir, f);
  return undefined;
}

async function skillsIn(dir: string, scope: 'global' | 'project', extra: Partial<ContextItem>) {
  if (!(await isDir(dir))) return [];
  const files = await fg('**/SKILL.md', { cwd: dir, absolute: true, dot: true, deep: 5 });
  const out: ContextItem[] = [];
  for (const md of files) {
    const it = await skillItem(md, scope, extra);
    if (it) out.push(it);
  }
  return out;
}

export async function discoverCodexContext(
  home: string,
  projectPaths: string[],
): Promise<ContextItem[]> {
  const dir = codexDir(home);
  const items: ContextItem[] = [];
  const add = (it: ContextItem | null) => it && items.push(it);

  const global = await agentsFile(dir);
  if (global)
    add(
      await fileItem('instructions-file', global, 'global', {
        name: `~/.codex/${global.split('/').pop()}`,
      }),
    );
  items.push(...(await skillsIn(join(dir, 'skills'), 'global', {})));
  items.push(...(await tomlItems(join(dir, 'config.toml'), 'global')));
  if (await isDir(join(dir, 'memories'))) {
    const mems = await fg('**/*.md', { cwd: join(dir, 'memories'), absolute: true, deep: 3 });
    for (const m of mems) add(await fileItem('memory-file', m, 'global'));
  }

  for (const p of projectPaths) {
    if (p === home) continue;
    const extra = { projectPath: p };
    const f = await agentsFile(p);
    if (f) add(await fileItem('instructions-file', f, 'project', extra));
    items.push(...(await skillsIn(join(p, '.codex', 'skills'), 'project', extra)));
    items.push(...(await tomlItems(join(p, '.codex', 'config.toml'), 'project', extra)));
    // alt dizin AGENTS.md'leri (Codex cwd'ye kadar olanları yükler)
    if (await isDir(p)) {
      const nested = await fg('**/AGENTS.md', {
        cwd: p,
        absolute: true,
        deep: 4,
        ignore: [...SCAN_IGNORE, 'AGENTS.md'],
        suppressErrors: true,
      });
      for (const n of nested)
        add(await fileItem('instructions-file', n, 'project', { ...extra, onDemand: true }));
    }
  }
  return items;
}
