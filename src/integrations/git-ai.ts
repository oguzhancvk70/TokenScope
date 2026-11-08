import { run } from '../util/exec.js';
import { isObj } from '../util/fs.js';
import type { Integration } from './types.js';

export interface AiNote {
  sha: string;
  sessionIds: string[];
  accepted: number;
  overridden: number;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Git AI authorship notu: üstte satır atıfları, "---" sonrası JSON metadata
export function parseAiNote(sha: string, note: string): AiNote {
  const ids = new Set<string>((note.match(UUID) ?? []).map((x) => x.toLowerCase()));
  let accepted = 0;
  let overridden = 0;
  const sep = note.indexOf('\n---');
  if (sep >= 0) {
    try {
      const meta = JSON.parse(note.slice(note.indexOf('{', sep)));
      const prompts = isObj(meta) && isObj(meta.prompts) ? Object.values(meta.prompts) : [];
      for (const p of prompts) {
        if (!isObj(p)) continue;
        if (isObj(p.agent_id) && typeof p.agent_id.id === 'string')
          ids.add(p.agent_id.id.toLowerCase());
        accepted += typeof p.accepted_lines === 'number' ? p.accepted_lines : 0;
        overridden += typeof p.overriden_lines === 'number' ? p.overriden_lines : 0;
        overridden += typeof p.overridden_lines === 'number' ? p.overridden_lines : 0;
      }
    } catch {}
  }
  return { sha, sessionIds: [...ids], accepted, overridden };
}

export const gitAi: Integration<AiNote[]> = {
  id: 'git-ai',
  async isAvailable(projectPath) {
    return (
      (await run('git', ['show-ref', '--verify', '--quiet', 'refs/notes/ai'], projectPath)) !==
      undefined
    );
  },
  async collect(projectPath) {
    const out = await run(
      'git',
      ['log', '--all', '--notes=ai', '--format=%x1e%H%x1f%N', '-n', '2000'],
      projectPath,
    );
    if (out === undefined) return null;
    return out
      .split('\x1e')
      .map((r) => r.split('\x1f'))
      .filter(([sha, note]) => sha && note?.trim())
      .map(([sha, note]) => parseAiNote(sha!.trim(), note!));
  },
};
