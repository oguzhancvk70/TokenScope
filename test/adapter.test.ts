import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from '../src/adapters/claude-code/index.js';
import type { Session } from '../src/model/types.js';
import { FIXTURE_HOME } from './helpers.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

async function load() {
  const adapter = createClaudeCodeAdapter({ homeDir: FIXTURE_HOME });
  const sessions: Session[] = [];
  for await (const s of adapter.loadSessions({ redact: true })) sessions.push(s);
  return { adapter, sessions, byId: (id: string) => sessions.find((s) => s.id === id) };
}

describe('claude-code adapter', () => {
  it('turn = message.id (bloklara bölünmüş satırlar tekrar sayılmaz)', async () => {
    const { byId } = await load();
    const a = byId(A)!;
    expect(a.turns).toHaveLength(9);
    const sum = (k: 'input' | 'output') => a.turns.reduce((n, t) => n + t.usage[k], 0);
    expect(sum('input')).toBe(60);
    expect(sum('output')).toBe(305);
    expect(a.turns.every((t) => t.usage.exact)).toBe(true);
    expect(a.models).toEqual(['claude-opus-5-5']);
  });

  it('tool çağrılarını sonuçlarla eşleştirir', async () => {
    const { byId } = await load();
    const calls = byId(A)!.turns.flatMap((t) => t.toolCalls);
    expect(calls).toHaveLength(11);
    expect(calls.filter((c) => c.isError)).toHaveLength(3);
    const read = calls.find((c) => c.id === 'tu1')!;
    expect(read.target).toBe('/tmp/demo/src/big.ts');
    expect(read.outputTokensEstimate).toBe(500);
    expect(calls.find((c) => c.id === 'tu11')!.range).toBe('10+20');
    const mcp = calls.find((c) => c.id === 'tu8')!;
    expect(mcp.isMcp).toBe(true);
    expect(mcp.mcpServer).toBe('docs');
    expect(calls.find((c) => c.id === 'tu7')!.target).toBe('npm test');
    expect(byId(A)!.skillsUsed).toContain('foo');
  });

  it('statik bağlam anlık görüntüsünü logdan çıkarır', async () => {
    const { byId } = await load();
    const snap = byId(A)!.contextSnapshot;
    const get = (kind: string, name?: string) =>
      snap.find((s) => s.kind === kind && (!name || s.name === name));
    expect(get('instructions-file', '/tmp/demo/CLAUDE.md')?.estimatedTokens).toBe(3000);
    expect(get('memory-file')).toBeDefined();
    expect(get('skill-listing')?.estimatedTokens).toBe(500);
    expect(get('mcp-instructions', 'docs')?.estimatedTokens).toBe(1000);
    expect(get('mcp-tools', 'docs')!.chars).toBeGreaterThan(2000);
    expect(get('system-prompt')?.estimatedTokens).toBe(2000);
  });

  it('bozuk / bilinmeyen satırlarda çökmez, sayar', async () => {
    const { adapter } = await load();
    expect(adapter.stats().skippedLines).toBe(1);
    expect(adapter.stats().unknownTypes).toBe(1);
    expect(adapter.stats().files).toBe(3);
  });

  it('subagent ve compaction', async () => {
    const { sessions, byId } = await load();
    const sub = sessions.find((s) => s.isSidechain)!;
    expect(sub.id).toBe(`${A}/agent-x`);
    expect(sub.parentSessionId).toBe(A);
    const b = byId(B)!;
    expect(b.compactions).toBe(1);
    expect(b.turns[1]?.compacted).toBe(true);
    expect(b.projectPath).toBe('/tmp/other');
  });

  it('since ve project filtreleri', async () => {
    const adapter = createClaudeCodeAdapter({ homeDir: FIXTURE_HOME });
    const got: string[] = [];
    for await (const s of adapter.loadSessions({ redact: true, project: '/tmp/other' }))
      got.push(s.id);
    expect(got).toEqual([B]);
    const none: string[] = [];
    for await (const s of adapter.loadSessions({ redact: true, since: new Date('2100-01-01') }))
      none.push(s.id);
    expect(none).toEqual([]);
  });
});
