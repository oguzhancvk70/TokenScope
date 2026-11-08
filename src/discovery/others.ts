import { join } from 'node:path';
import fg from 'fast-glob';
import type { InstalledTool, ToolId } from '../model/types.js';
import { exists } from '../util/fs.js';

interface Candidate {
  id: ToolId;
  markers: string[];
  logs: string[];
  configs: string[];
}

// v0.1: sadece "kurulu mu, log nerede" — veri okunmaz ("veri yok")
const CANDIDATES: Candidate[] = [
  {
    id: 'codex',
    markers: ['.codex'],
    logs: ['.codex/sessions', '.codex/history.jsonl', '.codex/logs_*.sqlite'],
    configs: ['.codex/config.toml', '.codex/AGENTS.md'],
  },
  {
    id: 'gemini-cli',
    markers: ['.gemini'],
    logs: ['.gemini/tmp'],
    configs: ['.gemini/settings.json', '.gemini/GEMINI.md'],
  },
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

export async function discoverOthers(home: string): Promise<InstalledTool[]> {
  const tools: InstalledTool[] = [];
  for (const c of CANDIDATES) {
    if (!(await existing(home, c.markers)).length) continue;
    tools.push({
      id: c.id,
      supported: false,
      logPaths: await existing(home, c.logs),
      configPaths: await existing(home, c.configs),
      contextItems: [],
    });
  }
  return tools;
}
