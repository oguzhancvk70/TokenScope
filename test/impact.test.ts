import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/constants.js';
import {
  type BaselineSnapshot,
  loadBaselines,
  saveBaseline,
} from '../src/impact/baseline-store.js';
import { compareEvent } from '../src/impact/compare.js';
import { eventsFromBaselines, eventsFromLogs } from '../src/impact/events.js';
import { median, periodMetrics } from '../src/impact/metrics.js';
import { impactLine } from '../src/report/impact.js';
import { NOW } from './helpers.js';
import { bash, session } from './session-builder.js';

const day = (d: number) => `2026-10-${String(d).padStart(2, '0')}T10:00:00Z`;
const before = Array.from({ length: 10 }, (_, i) =>
  session(`b${i}`, '/p', [bash('ls')], day(i + 1), {
    input: 1000,
    instructions: { '/p/CLAUDE.md': 6100 },
  }),
);
const after = Array.from({ length: 10 }, (_, i) =>
  session(`a${i}`, '/p', [bash('ls')], day(i + 15), {
    input: 800,
    instructions: { '/p/CLAUDE.md': 2300 },
  }),
);

describe('impact', () => {
  it('median', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('logdan talimat değişikliği olayı', () => {
    const ev = eventsFromLogs([...after, ...before]);
    expect(ev).toHaveLength(1);
    expect(ev[0]?.description).toBe('/p/CLAUDE.md 6.1k → 2.3k token');
    expect(ev[0]?.at.toISOString()).toBe(new Date(day(15)).toISOString());
  });

  it('önce/sonra karşılaştırması', async () => {
    const event = eventsFromLogs([...before, ...after])[0]!;
    const input = {
      inventory: { tools: [] },
      sessions: [...before, ...after],
      thresholds: { ...DEFAULT_THRESHOLDS },
      now: NOW,
      home: '/h',
    };
    const c = await compareEvent(event, input);
    expect(c.sufficientData).toBe(true);
    expect(c.before.avgInput).toBe(1000);
    expect(c.after.avgInput).toBe(800);
    expect(c.after.avgStaticContext).toBe(2300);
    expect(impactLine(c, NOW.toISOString())).toContain('input −%20 (n=10)');
    const thin = await compareEvent(event, {
      ...input,
      sessions: [...before, ...after.slice(0, 4)],
    });
    expect(thin.sufficientData).toBe(false);
    expect(impactLine(thin, NOW.toISOString())).toBeNull();
  });

  it('baseline kaydet/oku + MCP farkı olayları', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ts-home-'));
    const base = (at: string, mcp: string[]): BaselineSnapshot => ({
      version: 1,
      at,
      kind: 'manual-baseline',
      description: 'test',
      metrics: periodMetrics([], new Date(at), new Date(at)),
      mcpServers: mcp,
      skills: [],
      instructionTokens: {},
    });
    await saveBaseline(home, base('2026-10-01T00:00:00.000Z', ['a', 'b']));
    await saveBaseline(home, base('2026-10-05T00:00:00.000Z', ['b', 'c']));
    const loaded = await loadBaselines(home);
    expect(loaded).toHaveLength(2);
    const kinds = eventsFromBaselines(loaded).map((e) => `${e.kind}:${e.description}`);
    expect(kinds).toContain('mcp-added:MCP eklendi: c');
    expect(kinds).toContain('mcp-removed:MCP kaldırıldı: a');
  });
});
