import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { fmtTokens } from '../analyzers/util.js';
import type { ChangeEvent, Inventory, Session } from '../model/types.js';
import { run } from '../util/exec.js';
import { homeRel } from '../util/redact.js';
import type { BaselineSnapshot } from './baseline-store.js';

const DAY = 86_400_000;

// logdaki talimat dosyası boyutu oturumlar arasında değiştiyse olay
export function eventsFromLogs(sessions: Session[]): ChangeEvent[] {
  const last = new Map<string, number>();
  const out: ChangeEvent[] = [];
  const sorted = sessions
    .filter((s) => !s.isSidechain)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (const s of sorted) {
    for (const i of s.contextSnapshot) {
      if (i.kind !== 'instructions-file') continue;
      const prev = last.get(i.name);
      last.set(i.name, i.estimatedTokens);
      if (prev === undefined) continue;
      if (Math.abs(prev - i.estimatedTokens) < Math.max(50, prev * 0.05)) continue;
      out.push({
        at: s.startedAt,
        kind: 'instructions-edited',
        path: i.name,
        projectPath: i.name.startsWith('~/.claude/') ? undefined : s.projectPath,
        description: `${i.name} ${fmtTokens(prev)} → ${fmtTokens(i.estimatedTokens)} token`,
        source: 'log',
      });
    }
  }
  return out;
}

// git geçmişi; repo değilse dosya mtime'ı
export async function eventsFromFiles(inventory: Inventory): Promise<ChangeEvent[]> {
  const out: ChangeEvent[] = [];
  const seen = new Set<string>();
  for (const tool of inventory.tools) {
    for (const item of tool.contextItems) {
      if (item.kind !== 'instructions-file' || seen.has(item.path)) continue;
      seen.add(item.path);
      const name = homeRel(item.path) ?? item.path;
      const log = await run(
        'git',
        ['log', '-n', '20', '--format=%cI', '--', basename(item.path)],
        dirname(item.path),
      );
      const dates = log?.split('\n').filter(Boolean) ?? [];
      if (dates.length) {
        for (const d of dates)
          out.push({
            at: new Date(d),
            kind: 'instructions-edited',
            path: name,
            projectPath: item.projectPath,
            description: `${name} commit'lendi`,
            source: 'git',
          });
        continue;
      }
      try {
        const st = await stat(item.path);
        out.push({
          at: st.mtime,
          kind: 'instructions-edited',
          path: name,
          projectPath: item.projectPath,
          description: `${name} değiştirildi (dosya zamanı)`,
          source: 'mtime',
        });
      } catch {}
    }
  }
  return out;
}

const diff = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));

export function eventsFromBaselines(baselines: BaselineSnapshot[]): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  baselines.forEach((b, i) => {
    const at = new Date(b.at);
    out.push({
      at,
      kind: b.kind,
      projectPath: b.projectPath,
      description: b.description,
      source: 'baseline',
    });
    const prev = baselines
      .slice(0, i)
      .reverse()
      .find((p) => p.projectPath === b.projectPath);
    if (!prev) return;
    const add = (kind: ChangeEvent['kind'], names: string[], what: string) => {
      for (const n of names)
        out.push({
          at,
          kind,
          projectPath: b.projectPath,
          description: `${what}: ${n}`,
          source: 'baseline',
        });
    };
    add('mcp-added', diff(prev.mcpServers, b.mcpServers), 'MCP eklendi');
    add('mcp-removed', diff(b.mcpServers, prev.mcpServers), 'MCP kaldırıldı');
    add('skill-added', diff(prev.skills, b.skills), 'skill eklendi');
    add('skill-removed', diff(b.skills, prev.skills), 'skill kaldırıldı');
  });
  return out;
}

// aynı dosya için ±2 gün içindeki git/mtime olayı, log olayı varsa atılır
export function mergeEvents(...lists: ChangeEvent[][]): ChangeEvent[] {
  const all = lists.flat();
  const logs = all.filter((e) => e.source === 'log');
  return all
    .filter(
      (e) =>
        e.source === 'log' ||
        e.source === 'baseline' ||
        !logs.some((l) => l.path === e.path && Math.abs(l.at.getTime() - e.at.getTime()) < 2 * DAY),
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function detectEvents(
  inventory: Inventory,
  sessions: Session[],
  baselines: BaselineSnapshot[],
): Promise<ChangeEvent[]> {
  return mergeEvents(
    eventsFromLogs(sessions),
    await eventsFromFiles(inventory),
    eventsFromBaselines(baselines),
  );
}
