import { describe, expect, it } from 'vitest';
import { scanFixture } from './helpers.js';

describe('discovery + kullanım çaprazlaması', async () => {
  const r = await scanFixture();
  const cc = r.inventory.tools.find((t) => t.id === 'claude-code')!;
  const item = (name: string) => cc.contextItems.find((i) => i.name === name);

  it('Claude Code envanteri', () => {
    expect(cc.supported).toBe(true);
    expect(cc.version).toBe('2.1.319');
    expect(item('~/.claude/CLAUDE.md')?.kind).toBe('instructions-file');
    expect(item('MEMORY.md (demo)')?.kind).toBe('memory-file');
    expect(item('bar')?.kind).toBe('skill');
    expect(item('helper')?.kind).toBe('plugin');
    expect(item('helper:helper-skill')?.plugin).toBe('helper');
    expect(item('plugin:helper:helperdb')?.kind).toBe('mcp-server');
    expect(item('unused-server')?.estimateSource).toBe('none');
    expect(cc.contextItems.some((i) => i.kind === 'hook')).toBe(true);
  });

  it('logda görülen MCP sunucusu envantere eklenir ve boyutu logdan gelir', () => {
    const docs = item('docs')!;
    expect(docs.estimateSource).toBe('log');
    expect(docs.estimatedTokens).toBeGreaterThan(1000);
    expect(docs.usageCount).toBe(1);
  });

  it('skill kullanımı log + ~/.claude.json sayaçlarından', () => {
    expect(item('foo')?.usageCount).toBe(4);
    expect(item('bar')?.usageCount).toBeUndefined();
  });
});
