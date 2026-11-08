import type { ContextItem, InstalledTool, Session } from '../model/types.js';
import type { UsageCounter } from './claude-code.js';

export const normalizeServer = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '_');
export const skillBase = (s: string): string => s.split(':').pop() ?? s;

interface Use {
  count: number;
  last?: Date;
}

const bump = (m: Map<string, Use>, key: string, at: Date, n = 1) => {
  const u = m.get(key) ?? { count: 0 };
  u.count += n;
  if (!u.last || at > u.last) u.last = at;
  m.set(key, u);
};

const mergeUse = (item: ContextItem, u: Use | UsageCounter | undefined) => {
  if (!u) return;
  const count = 'count' in u ? u.count : u.usageCount;
  const last = 'count' in u ? u.last : u.lastUsedAt;
  item.usageCount = (item.usageCount ?? 0) + count;
  if (last && (!item.lastUsedAt || last > item.lastUsedAt)) item.lastUsedAt = last;
};

// logda görülen MCP sunucularını envantere ekler ve boyutlarını logdan doldurur
export function mergeLogMcpServers(tool: InstalledTool, sessions: Session[]): void {
  const sizes = new Map<string, { name: string; total: number; sessions: number }>();
  for (const s of sessions) {
    if (s.isSidechain) continue;
    const perSession = new Map<string, { name: string; tokens: number }>();
    for (const it of s.contextSnapshot) {
      if (it.kind !== 'mcp-tools' && it.kind !== 'mcp-instructions') continue;
      const key = normalizeServer(it.name);
      const e = perSession.get(key) ?? { name: it.name, tokens: 0 };
      e.tokens += it.estimatedTokens;
      perSession.set(key, e);
    }
    for (const [key, e] of perSession) {
      const agg = sizes.get(key) ?? { name: e.name, total: 0, sessions: 0 };
      agg.total += e.tokens;
      agg.sessions++;
      sizes.set(key, agg);
    }
  }
  const called = new Set<string>();
  for (const s of sessions)
    for (const t of s.turns) for (const c of t.toolCalls) if (c.mcpServer) called.add(c.mcpServer);

  const byKey = new Map(
    tool.contextItems
      .filter((i) => i.kind === 'mcp-server')
      .map((i) => [normalizeServer(i.name), i] as const),
  );
  const ensure = (key: string, name: string): ContextItem => {
    let item = byKey.get(key);
    if (!item) {
      item = {
        kind: 'mcp-server',
        name,
        path: '(log)',
        scope: 'global',
        estimatedTokens: 0,
        estimateSource: 'none',
      };
      tool.contextItems.push(item);
      byKey.set(key, item);
    }
    return item;
  };
  for (const [key, agg] of sizes) {
    const item = ensure(key, agg.name);
    item.estimatedTokens = Math.round(agg.total / agg.sessions);
    item.estimateSource = 'log';
  }
  for (const server of called) ensure(normalizeServer(server), server);
}

export function annotateUsage(
  tool: InstalledTool,
  sessions: Session[],
  counters: { skills: Map<string, UsageCounter>; plugins: Map<string, UsageCounter> },
): void {
  const skillUses = new Map<string, Use>();
  const mcpUses = new Map<string, Use>();
  for (const s of sessions) {
    const skillCalls = new Map<string, number>();
    for (const t of s.turns) {
      for (const c of t.toolCalls) {
        if (c.skillName) skillCalls.set(c.skillName, (skillCalls.get(c.skillName) ?? 0) + 1);
        if (c.mcpServer) bump(mcpUses, normalizeServer(c.mcpServer), t.timestamp);
      }
    }
    for (const name of new Set([...s.skillsUsed, ...skillCalls.keys()])) {
      bump(skillUses, name, s.endedAt, skillCalls.get(name) ?? 1);
    }
  }

  for (const item of tool.contextItems) {
    if (item.kind === 'skill') {
      const base = skillBase(item.name);
      for (const [name, u] of skillUses)
        if (name === item.name || skillBase(name) === base) mergeUse(item, u);
      for (const [name, u] of counters.skills)
        if (name === item.name || skillBase(name) === base) mergeUse(item, u);
    } else if (item.kind === 'mcp-server') {
      mergeUse(item, mcpUses.get(normalizeServer(item.name)));
    } else if (item.kind === 'plugin') {
      for (const [key, u] of counters.plugins)
        if (key === item.name || key.startsWith(`${item.name}@`)) mergeUse(item, u);
      for (const [name, u] of skillUses) if (name.startsWith(`${item.name}:`)) mergeUse(item, u);
      const prefix = normalizeServer(`plugin:${item.name}:`);
      for (const [key, u] of mcpUses) if (key.startsWith(prefix)) mergeUse(item, u);
    }
  }
}
