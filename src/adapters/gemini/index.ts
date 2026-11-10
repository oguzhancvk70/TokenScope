import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import fg from 'fast-glob';
import {
  discoverGeminiContext,
  geminiDir,
  geminiInstalled,
  geminiMcpNames,
} from '../../discovery/gemini.js';
import type { InstalledTool, Session } from '../../model/types.js';
import { exists, isDir, isObj, readJson, readText } from '../../util/fs.js';
import { type Adapter, emptyStats, type LoadOptions } from '../types.js';
import { parseGeminiFile } from './parse.js';

const inProject = (s: Session, project: string): boolean =>
  s.cwds.some((c) => c === project || c.startsWith(project + sep));

// tmp/<slug> → proje yolu: .project_root dosyası, yoksa projects.json
async function projectRoots(home: string): Promise<Map<string, string>> {
  const tmp = join(geminiDir(home), 'tmp');
  const roots = new Map<string, string>();
  const reg = await readJson(join(geminiDir(home), 'projects.json'));
  if (isObj(reg) && isObj(reg.projects))
    for (const [path, slug] of Object.entries(reg.projects))
      if (typeof slug === 'string') roots.set(slug, path);
  for (const marker of await fg('*/.project_root', {
    cwd: tmp,
    absolute: true,
    dot: true,
    suppressErrors: true,
  })) {
    const p = (await readText(marker))?.trim();
    if (p) roots.set(relative(tmp, dirname(marker)), p);
  }
  return roots;
}

export function createGeminiAdapter(opts: { homeDir?: string } = {}): Adapter {
  const home = opts.homeDir ?? homedir();
  const dir = geminiDir(home);
  const tmp = join(dir, 'tmp');
  const stats = emptyStats();

  return {
    id: 'gemini-cli',
    stats: () => stats,

    async detect({ projectPaths = [] } = {}): Promise<InstalledTool | null> {
      if (!(await geminiInstalled(home))) return null;
      const configPaths: string[] = [];
      const cfg = join(dir, 'settings.json');
      if (await exists(cfg)) configPaths.push(cfg);
      return {
        id: 'gemini-cli',
        supported: true,
        logPaths: (await isDir(tmp)) ? [tmp] : [],
        configPaths,
        contextItems: await discoverGeminiContext(home, projectPaths),
      };
    },

    async *loadSessions({ since, project, redact }: LoadOptions): AsyncIterable<Session> {
      if (!(await isDir(tmp))) return;
      const roots = await projectRoots(home);
      const mcpServers = await geminiMcpNames(home);
      const files = await fg(['*/chats/session-*.{json,jsonl}', '*/chats/*/*.jsonl'], {
        cwd: tmp,
        absolute: true,
        suppressErrors: true,
      });
      for (const file of files.sort()) {
        if (since) {
          try {
            if ((await stat(file)).mtime < since) continue;
          } catch {
            continue;
          }
        }
        const slug = relative(tmp, file).split(sep)[0] ?? '';
        const session = await parseGeminiFile(
          file,
          { redact, projectPath: roots.get(slug), mcpServers },
          stats,
        );
        if (!session) continue;
        if (since && session.endedAt < since) continue;
        if (project && !inProject(session, project)) continue;
        yield session;
      }
    },
  };
}
