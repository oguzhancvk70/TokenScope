import { join } from 'node:path';
import fg from 'fast-glob';
import type { ContextItem, InstalledTool, ToolId } from '../model/types.js';
import { exists, isObj, readJson, readText } from '../util/fs.js';
import { fileItem, mcpItems } from './claude-code.js';

interface Candidate {
  id: ToolId;
  markers: string[];
  logs: string[];
  configs: string[];
}

// oturum verisi okunmaz ("veri yok"); Cursor için statik bağlam envanteri çıkarılır
const CANDIDATES: Candidate[] = [
  {
    id: 'cursor',
    markers: [
      '.cursor',
      'Library/Application Support/Cursor',
      '.config/Cursor',
      'AppData/Roaming/Cursor',
    ],
    logs: [
      'Library/Application Support/Cursor/User/globalStorage/state.vscdb',
      '.config/Cursor/User/globalStorage/state.vscdb',
      'AppData/Roaming/Cursor/User/globalStorage/state.vscdb',
    ],
    configs: ['.cursor/mcp.json'],
  },
];

async function existing(home: string, patterns: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of patterns) {
    if (p.includes('*')) {
      out.push(
        ...(await fg(p, {
          cwd: home,
          absolute: true,
          dot: true,
          onlyFiles: false,
          suppressErrors: true,
        })),
      );
    } else if (await exists(join(home, p))) {
      out.push(join(home, p));
    }
  }
  return out;
}

async function mcpJson(
  path: string,
  scope: 'global' | 'project',
  extra: Partial<ContextItem> = {},
) {
  const cfg = await readJson(path);
  return isObj(cfg) ? mcpItems(cfg.mcpServers, path, scope, extra) : [];
}

// .cursorrules, .cursor/rules/*.mdc (alwaysApply olmayanlar isteğe bağlı), mcp.json
export async function discoverCursorContext(
  home: string,
  projectPaths: string[],
): Promise<ContextItem[]> {
  const items: ContextItem[] = [...(await mcpJson(join(home, '.cursor', 'mcp.json'), 'global'))];
  const add = (it: ContextItem | null) => it && items.push(it);
  for (const p of projectPaths) {
    if (p === home) continue;
    const extra = { projectPath: p };
    add(await fileItem('instructions-file', join(p, '.cursorrules'), 'project', extra));
    const rules = await fg('**/*.{mdc,md}', {
      cwd: join(p, '.cursor', 'rules'),
      absolute: true,
      deep: 3,
      suppressErrors: true,
    });
    for (const r of rules) {
      const it = await fileItem('instructions-file', r, 'project', extra);
      if (!it) continue;
      const head = ((await readText(r)) ?? '').slice(0, 500);
      if (!/^alwaysApply:\s*true/m.test(head)) it.onDemand = true;
      add(it);
    }
    items.push(...(await mcpJson(join(p, '.cursor', 'mcp.json'), 'project', extra)));
  }
  return items;
}

export async function discoverOthers(
  home: string,
  projectPaths: string[] = [],
): Promise<InstalledTool[]> {
  const tools: InstalledTool[] = [];
  for (const c of CANDIDATES) {
    if (!(await existing(home, c.markers)).length) continue;
    tools.push({
      id: c.id,
      supported: false,
      logPaths: await existing(home, c.logs),
      configPaths: await existing(home, c.configs),
      contextItems: c.id === 'cursor' ? await discoverCursorContext(home, projectPaths) : [],
    });
  }
  return tools;
}
