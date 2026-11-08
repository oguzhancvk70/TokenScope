import type { CommitRef, GitCorrelation, Session } from '../model/types.js';
import { run } from '../util/exec.js';
import { isDir } from '../util/fs.js';
import { gitAi } from './git-ai.js';

const SLACK = 10 * 60_000;

export function parseGitLog(out: string): CommitRef[] {
  const commits: CommitRef[] = [];
  for (const rec of out.split('\x1e').slice(1)) {
    const [head = '', ...rest] = rec.trim().split('\n');
    const [sha, date] = head.split('\x1f');
    if (!sha || !date) continue;
    const stat = rest.join(' ');
    const n = (re: RegExp) => Number(stat.match(re)?.[1] ?? 0);
    commits.push({
      sha,
      timestamp: new Date(date),
      filesChanged: n(/(\d+) files? changed/),
      insertions: n(/(\d+) insertions?/),
      deletions: n(/(\d+) deletions?/),
      matchConfidence: 'low',
    });
  }
  return commits;
}

// Git AI notu varsa kesin eşleşme, yoksa oturum zaman aralığı (±10 dk)
export async function correlateGit(sessions: Session[]): Promise<GitCorrelation[]> {
  const byProject = new Map<string, Session[]>();
  for (const s of sessions)
    byProject.set(s.projectPath, [...(byProject.get(s.projectPath) ?? []), s]);
  const out: GitCorrelation[] = [];
  for (const [project, list] of byProject) {
    if (!project.startsWith('/') || !(await isDir(project))) continue;
    const since = new Date(Math.min(...list.map((s) => s.startedAt.getTime())) - SLACK);
    const log = await run(
      'git',
      ['log', `--since=${since.toISOString()}`, '--format=%x1e%H%x1f%cI', '--shortstat'],
      project,
    );
    if (log === undefined) continue;
    const commits = parseGitLog(log);
    const notes = (await gitAi.isAvailable(project)) ? ((await gitAi.collect(project)) ?? []) : [];
    const noteBySha = new Map(notes.map((n) => [n.sha, n]));
    let matched = 0;
    let high = 0;
    for (const c of commits) {
      const note = noteBySha.get(c.sha);
      let target = note
        ? list.find((s) => note.sessionIds.some((id) => s.id.toLowerCase().startsWith(id)))
        : undefined;
      const exact = !!target;
      if (exact) high++;
      else {
        target = list.find(
          (s) =>
            c.timestamp.getTime() >= s.startedAt.getTime() - SLACK &&
            c.timestamp.getTime() <= s.endedAt.getTime() + SLACK,
        );
      }
      if (!target) continue;
      matched++;
      target.commits = [
        ...(target.commits ?? []),
        { ...c, matchConfidence: exact ? 'high' : 'low' },
      ];
    }
    const accepted = notes.reduce((n, x) => n + x.accepted, 0);
    const overridden = notes.reduce((n, x) => n + x.overridden, 0);
    out.push({
      projectPath: project,
      commits: commits.length,
      matched,
      highConfidence: high,
      ...(accepted + overridden > 0
        ? { aiRewriteRatio: overridden / (accepted + overridden) }
        : {}),
    });
  }
  return out;
}
