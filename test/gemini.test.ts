import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGeminiAdapter } from '../src/adapters/gemini/index.js';
import { geminiMcpServer } from '../src/adapters/gemini/parse.js';
import { computeModelAdvice } from '../src/analyzers/model-fit.js';
import type { InstructionRule, Session } from '../src/model/types.js';
import { appliesTo } from '../src/rules-audit/audit.js';
import { loadRules } from '../src/rules-audit/extract.js';
import { runScan } from '../src/scan.js';

const HOME = fileURLToPath(new URL('./fixtures/gemini/home', import.meta.url));
const PROJECT = fileURLToPath(new URL('./fixtures/gemini/project', import.meta.url));
const SID = 'aaaa1111-0000-4000-8000-000000000001';

async function load() {
  const adapter = createGeminiAdapter({ homeDir: HOME });
  const sessions: Session[] = [];
  for await (const s of adapter.loadSessions({ redact: true })) sessions.push(s);
  return { adapter, sessions, byId: (id: string) => sessions.find((s) => s.id === id)! };
}

describe('gemini adapter', () => {
  it('aynı id = güncelleme; token alanları ortak modele çevrilir', async () => {
    const { byId, adapter } = await load();
    const s = byId(SID);
    expect(s.tool).toBe('gemini-cli');
    expect(s.projectPath).toBe('/work/gem');
    expect(s.models).toEqual(['gemini-2.5-pro']);
    expect(s.turns).toHaveLength(2);
    const sum = (k: 'input' | 'output' | 'cacheRead') =>
      s.turns.reduce((n, t) => n + t.usage[k], 0);
    expect(sum('input')).toBe(1305);
    expect(sum('output')).toBe(110);
    expect(sum('cacheRead')).toBe(1200);
    expect(s.turns.every((t) => t.usage.exact)).toBe(true);
    expect(s.endedAt.toISOString()).toBe('2026-11-06T09:00:08.000Z');
    expect(adapter.stats()).toMatchObject({ files: 3, skippedLines: 1, unknownTypes: 1 });
  });

  it('araçları ortak adlara çevirir', async () => {
    const { byId } = await load();
    const calls = byId(SID).turns.flatMap((t) => t.toolCalls);
    const by = (id: string) => calls.find((c) => c.id === id)!;
    expect(by('t1')).toMatchObject({ name: 'Read', target: '/work/gem/src/a.ts', range: '1+50' });
    expect(by('t1').outputSize).toBe(400);
    expect(by('t2')).toMatchObject({ name: 'Bash', target: 'npm run', isError: true });
    expect(by('t3')).toMatchObject({ isMcp: true, mcpServer: 'my-tools' });
    expect(by('t4')).toMatchObject({ name: 'Skill', skillName: 'lint' });
    expect(byId(SID).skillsUsed).toEqual(['lint']);
  });

  it('subagent ve eski .json formatı', async () => {
    const { byId } = await load();
    const sub = byId(`${SID}/sub-1`);
    expect(sub.isSidechain).toBe(true);
    expect(sub.parentSessionId).toBe(SID);
    const legacy = byId('legacy-1');
    expect(legacy.projectPath).toBe('/work/legacy');
    expect(legacy.turns[0]?.usage.input).toBe(100);
  });

  it('MCP adı ayrıştırma', () => {
    expect(geminiMcpServer('mcp_my-tools_search', ['my-tools'])).toBe('my-tools');
    expect(geminiMcpServer('mcp_docs_get_page')).toBe('docs');
    expect(geminiMcpServer('docs__get')).toBe('docs');
    expect(geminiMcpServer('read_file')).toBeUndefined();
  });

  it('discovery: GEMINI.md, skills, MCP, extension', async () => {
    const tool = await createGeminiAdapter({ homeDir: HOME }).detect({ projectPaths: [PROJECT] });
    const items = tool!.contextItems.map((i) => `${i.kind}:${i.scope}:${i.name}`);
    expect(items).toContain('instructions-file:global:~/.gemini/GEMINI.md');
    expect(items.filter((i) => i === 'instructions-file:project:GEMINI.md')).toHaveLength(2);
    expect(items).toContain('skill:global:lint');
    expect(items).toContain('mcp-server:global:docs');
    expect(items).toContain('mcp-server:project:local');
    expect(items).toContain('plugin:global:ext1');
    expect(items).toContain('mcp-server:global:plugin:ext1:extmcp');
    expect(items).toContain('instructions-file:global:EXT.md');
  });
});

describe('araç bazlı kural denetimi ve rapor', () => {
  it('kural sadece dosyayı yükleyen aracın oturumlarına uygulanır', async () => {
    const r = await runScan({ homeDir: HOME, redact: true, analyze: false, project: undefined });
    const rules = await loadRules(r.inventory);
    const g = rules.find((x) => x.source.path.endsWith('.gemini/GEMINI.md'))!;
    expect(g.source.tools).toEqual(['gemini-cli']);
    const s = r.sessions[0]!;
    expect(appliesTo(g, s)).toBe(true);
    const codexOnly: InstructionRule = { ...g, source: { ...g.source, tools: ['codex'] } };
    expect(appliesTo(codexOnly, s)).toBe(false);
  });

  it('özet araç bazında token ve maliyet taşır; öneriler Google modelleri', async () => {
    const r = await runScan({ homeDir: HOME, redact: true, extras: false });
    const g = r.summary.tools.find((t) => t.id === 'gemini-cli')!;
    expect(g.sessions).toBe(2);
    expect(g.tokens.total).toBeGreaterThan(0);
    expect(g.estCostUSD).toBeGreaterThan(0);
    const advice = computeModelAdvice(r.sessions);
    expect(advice.every((a) => a.options.every((o) => o.model.startsWith('gemini-')))).toBe(true);
  });
});
