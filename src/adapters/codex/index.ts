import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import fg from 'fast-glob';
import { codexDir, codexInstalled, discoverCodexContext } from '../../discovery/codex.js';
import type { InstalledTool, Session } from '../../model/types.js';
import { exists, isDir } from '../../util/fs.js';
import { type Adapter, emptyStats, type LoadOptions } from '../types.js';
import { parseCodexFile } from './parse.js';

const inProject = (s: Session, project: string): boolean =>
  s.cwds.some((c) => c === project || c.startsWith(project + sep));

export function createCodexAdapter(opts: { homeDir?: string } = {}): Adapter {
  const home = opts.homeDir ?? homedir();
  const dir = codexDir(home);
  const sessionDirs = [join(dir, 'sessions'), join(dir, 'archived_sessions')];
  const stats = emptyStats();

  return {
    id: 'codex',
    stats: () => stats,

    async detect({ projectPaths = [] } = {}): Promise<InstalledTool | null> {
      if (!(await codexInstalled(home))) return null;
      const logPaths: string[] = [];
      for (const d of sessionDirs) if (await isDir(d)) logPaths.push(d);
      const configPaths: string[] = [];
      const cfg = join(dir, 'config.toml');
      if (await exists(cfg)) configPaths.push(cfg);
      return {
        id: 'codex',
        supported: true,
        logPaths,
        configPaths,
        contextItems: await discoverCodexContext(home, projectPaths),
      };
    },

    async *loadSessions({ since, project, redact }: LoadOptions): AsyncIterable<Session> {
      const files: string[] = [];
      for (const d of sessionDirs) {
        if (!(await isDir(d))) continue;
        files.push(
          ...(await fg('**/rollout-*.jsonl', { cwd: d, absolute: true, suppressErrors: true })),
        );
      }
      for (const file of files.sort()) {
        if (since) {
          try {
            if ((await stat(file)).mtime < since) continue;
          } catch {
            continue;
          }
        }
        const session = await parseCodexFile(file, { redact }, stats);
        if (!session) continue;
        if (since && session.endedAt < since) continue;
        if (project && !inProject(session, project)) continue;
        yield session;
      }
    },
  };
}
