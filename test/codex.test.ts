import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCodexAdapter } from '../src/adapters/codex/index.js';
import { codexMcpServer } from '../src/adapters/codex/parse.js';
import { computeModelAdvice } from '../src/analyzers/model-fit.js';
import { tomlMcpServers } from '../src/discovery/codex.js';
import { discoverOthers } from '../src/discovery/others.js';
import type { Session } from '../src/model/types.js';
import { costWithRates, MODELS } from '../src/pricing.js';
import { runScan } from '../src/scan.js';

const HOME = fileURLToPath(new URL('./fixtures/codex/home', import.meta.url));
const PROJECT = fileURLToPath(new URL('./fixtures/codex/project', import.meta.url));

async function load() {
  const adapter = createCodexAdapter({ homeDir: HOME });
  const sessions: Session[] = [];
  for await (const s of adapter.loadSessions({ redact: true })) sessions.push(s);
  return { adapter, s: sessions[0]! };
}

describe('codex adapter', () => {
  it('token_count → turn; tekrar eden toplam atlanır, cache ayrılır', async () => {
    const { s, adapter } = await load();
    expect(s.tool).toBe('codex');
    expect(s.id).toBe('33333333-3333-4333-8333-333333333333');
    expect(s.projectPath).toBe('/work/demo');
    expect(s.version).toBe('0.80.0');
    expect(s.models).toEqual(['gpt-6.1-sol']);
    expect(s.turns).toHaveLength(5);
    const sum = (k: 'input' | 'output' | 'cacheRead') =>
      s.turns.reduce((n, t) => n + t.usage[k], 0);
    expect(sum('input')).toBe(2400);
    expect(sum('output')).toBe(300);
    expect(sum('cacheRead')).toBe(3700);
    expect(s.turns.every((t) => t.usage.exact)).toBe(true);
    expect(s.compactions).toBe(1);
    expect(s.turns[4]?.compacted).toBe(true);
    expect(adapter.stats()).toMatchObject({ files: 1, skippedLines: 1, unknownTypes: 1 });
  });

  it('araçları ortak adlara çevirir', async () => {
    const { s } = await load();
    const calls = s.turns.flatMap((t) => t.toolCalls);
    const by = (id: string) => calls.find((c) => c.id === id)!;
    expect(by('c1')).toMatchObject({ name: 'Read', target: 'src/app.ts', isError: false });
    expect(by('c1').outputSize).toBeGreaterThan(800);
    expect(by('c2')).toMatchObject({ name: 'Bash', target: 'npm test', isError: true });
    expect(by('c2').commands).toEqual(['npm test']);
    expect(calls.filter((c) => c.name === 'Edit').map((c) => c.target)).toEqual([
      'src/app.ts',
      'src/new.ts',
    ]);
    expect(by('c4')).toMatchObject({ isMcp: true, mcpServer: 'docs' });
    expect(by('c5')).toMatchObject({ name: 'Read', skillName: 'review' });
    expect(s.skillsUsed).toEqual(['review']);
  });

  it('statik bağlamı logdan ölçer', async () => {
    const { s } = await load();
    const kinds = s.contextSnapshot.map((i) => `${i.kind}:${i.name}`);
    expect(kinds).toContain('instructions-file:user_instructions');
    expect(kinds).toContain('system-prompt:environment_context');
  });

  it('MCP adı ayrıştırma', () => {
    expect(codexMcpServer('mcp__docs__search')).toBe('docs');
    expect(codexMcpServer('docs__search')).toBe('docs');
    expect(codexMcpServer('shell')).toBeUndefined();
    expect(tomlMcpServers('[mcp_servers.a]\n[mcp_servers."b-c"]\n[mcp_servers.a.env]\n')).toEqual([
      'a',
      'b-c',
    ]);
  });

  it('discovery: AGENTS.md, skills, config.toml MCP', async () => {
    const tool = await createCodexAdapter({ homeDir: HOME }).detect({ projectPaths: [PROJECT] });
    const items = tool!.contextItems.map((i) => `${i.kind}:${i.scope}:${i.name}`);
    expect(items).toContain('instructions-file:global:~/.codex/AGENTS.md');
    expect(items).toContain('instructions-file:project:AGENTS.md');
    expect(items).toContain('skill:global:review');
    expect(items).toContain('skill:global:plan');
    expect(items).toContain('mcp-server:global:docs');
    expect(items).toContain('mcp-server:global:github-tools');
    expect(items).toContain('mcp-server:project:local');
  });
});

describe('cursor envanteri', () => {
  it('kurallar ve mcp.json; oturum verisi yok', async () => {
    const tools = await discoverOthers(HOME, [PROJECT]);
    const cursor = tools.find((t) => t.id === 'cursor')!;
    expect(cursor.supported).toBe(false);
    const by = (n: string) => cursor.contextItems.find((i) => i.name === n);
    expect(by('.cursorrules')?.kind).toBe('instructions-file');
    expect(by('always.mdc')?.onDemand).toBeUndefined();
    expect(by('ts.mdc')?.onDemand).toBe(true);
    expect(by('browser')?.kind).toBe('mcp-server');
    expect(tools.some((t) => t.id === 'codex')).toBe(false);
  });
});

describe('openai fiyatları ve model-fit', () => {
  it('uzun bağlamda girdi 2x, çıktı 1.5x', () => {
    const r = MODELS['gpt-6.1-sol']!;
    const u = { input: 300_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, exact: true };
    expect(costWithRates(r, u)).toBeCloseTo((300_000 * 2 * 2 + 1_000_000 * 10 * 1.5) / 1e6);
  });

  it('codex oturumuna sadece OpenAI modelleri önerilir', async () => {
    const { s } = await load();
    const advice = computeModelAdvice([s]);
    expect(advice[0]?.options.every((o) => o.model.startsWith('gpt-'))).toBe(true);
  });

  it('scan iki aracı birlikte toplar', async () => {
    const r = await runScan({ homeDir: HOME, redact: true, analyze: false });
    expect(r.sessions.map((x) => x.tool)).toEqual(['codex']);
    expect(r.inventory.tools.map((t) => t.id).sort()).toEqual(['codex', 'cursor']);
    expect(r.summary.parse.files).toBe(1);
  });
});
