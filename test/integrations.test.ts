import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { duplicateCode } from '../src/analyzers/duplicate-code.js';
import { DEFAULT_THRESHOLDS } from '../src/constants.js';
import { parseGitLog } from '../src/integrations/git.js';
import { parseAiNote } from '../src/integrations/git-ai.js';
import { parseJscpdReport } from '../src/integrations/jscpd.js';
import { summarizeCommands } from '../src/util/redact.js';
import { NOW } from './helpers.js';
import { read, session } from './session-builder.js';

const fx = (p: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${p}`, import.meta.url)), 'utf8');

describe('integrations', () => {
  it('jscpd raporu + okunma maliyeti', () => {
    const d = parseJscpdReport(JSON.parse(fx('jscpd/jscpd-report.json')), '/p')!;
    expect(d.percentage).toBe(4.2);
    expect(d.clones[0]).toEqual({ files: ['src/a.ts', 'src/b.ts'], lines: 21, tokens: 180 });
    const s = session('x', '/p', [read('/p/src/a.ts'), read('/p/src/b.ts'), read('/p/src/c.ts')]);
    const f = duplicateCode.run({
      inventory: { tools: [] },
      sessions: [s],
      thresholds: { ...DEFAULT_THRESHOLDS },
      now: NOW,
      duplication: [d],
    });
    expect(f[0]?.title).toContain('2 dosya 2 kez okundu');
  });

  it('Git AI notu', () => {
    const n = parseAiNote('abc', fx('git-ai/note.txt'));
    expect(n.sessionIds).toContain('11111111-1111-4111-8111-111111111111');
    expect(n.accepted).toBe(15);
    expect(n.overridden).toBe(5);
  });

  it('git log --shortstat', () => {
    const out =
      '\x1eaaa\x1f2026-11-01T10:00:00+00:00\n\n 2 files changed, 10 insertions(+), 3 deletions(-)\n\x1ebbb\x1f2026-11-02T10:00:00+00:00\n';
    const c = parseGitLog(out);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({
      sha: 'aaa',
      filesChanged: 2,
      insertions: 10,
      deletions: 3,
      matchConfidence: 'low',
    });
  });

  it('zincir komut özetleri', () => {
    expect(summarizeCommands('cd x && npm install foo && git push origin main')).toEqual([
      'npm install',
      'git push',
    ]);
  });
});
