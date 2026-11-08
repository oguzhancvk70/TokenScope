import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import fg from 'fast-glob';
import {
  claudeDir,
  claudeInstalled,
  claudeJson,
  discoverClaudeContext,
  readUsageCounters,
} from '../../discovery/claude-code.js';
import type { InstalledTool, Session } from '../../model/types.js';
import { exists, isDir } from '../../util/fs.js';
import { type Adapter, emptyStats, type LoadOptions } from '../types.js';
import { parseSessionFile } from './parse.js';

const inProject = (s: Session, project: string): boolean =>
  s.cwds.some((c) => c === project || c.startsWith(project + sep));

export function createClaudeCodeAdapter(opts: { homeDir?: string } = {}) {
  const home = opts.homeDir ?? homedir();
  const projectsDir = join(claudeDir(home), 'projects');
  const stats = emptyStats();

  const adapter: Adapter & { usageCounters: () => ReturnType<typeof readUsageCounters> } = {
    id: 'claude-code',
    stats: () => stats,
    usageCounters: () => readUsageCounters(home),

    async detect({ projectPaths = [] } = {}): Promise<InstalledTool | null> {
      if (!(await claudeInstalled(home))) return null;
      const configPaths: string[] = [];
      for (const p of [join(claudeDir(home), 'settings.json'), claudeJson(home)]) {
        if (await exists(p)) configPaths.push(p);
      }
      return {
        id: 'claude-code',
        supported: true,
        logPaths: (await isDir(projectsDir)) ? [projectsDir] : [],
        configPaths,
        contextItems: await discoverClaudeContext(home, projectPaths),
      };
    },

    async *loadSessions({ since, project, redact }: LoadOptions): AsyncIterable<Session> {
      if (!(await isDir(projectsDir))) return;
      const files = await fg('**/*.jsonl', {
        cwd: projectsDir,
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
        const session = await parseSessionFile(file, { redact }, stats);
        if (!session) continue;
        if (since && session.endedAt < since) continue;
        if (project && !inProject(session, project)) continue;
        yield session;
      }
    },
  };
  return adapter;
}
