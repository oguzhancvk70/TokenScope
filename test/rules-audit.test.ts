import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { conflictingRules } from '../src/analyzers/conflicting-rules.js';
import { deadRules } from '../src/analyzers/dead-rules.js';
import { ruleViolations } from '../src/analyzers/rule-violations.js';
import { staleRules } from '../src/analyzers/stale-rules.js';
import { DEFAULT_THRESHOLDS } from '../src/constants.js';
import type { InstructionRule, RuleAuditResult } from '../src/model/types.js';
import { auditRules } from '../src/rules-audit/audit.js';
import { extractRules } from '../src/rules-audit/extract.js';
import { NOW } from './helpers.js';
import { bash, edit, session } from './session-builder.js';

const dir = (p: string) => fileURLToPath(new URL(`./fixtures/instructions/${p}`, import.meta.url));
const load = (p: string, scope: 'global' | 'project' = 'project') => {
  const path = `${dir(p)}/CLAUDE.md`;
  return extractRules(readFileSync(path, 'utf8'), {
    path,
    scope,
    projectPath: scope === 'project' ? dir(p) : undefined,
  });
};
const kinds = (rules: InstructionRule[]) => rules.map((r) => r.kind);

describe('extract', () => {
  it('EN kalıpları', () => {
    const r = load('en/project');
    expect(kinds(r)).toEqual([
      'package-manager',
      'forbidden-command',
      'forbidden-path',
      'required-command',
      'path-reference',
      'script-reference',
      'script-reference',
      'unclassified',
    ]);
    expect(r[0]?.params).toEqual({ expected: 'pnpm', forbidden: 'npm,yarn,bun' });
    expect(r[3]?.params).toEqual({ command: 'pnpm test', before: 'commit' });
    expect(r[0]?.source.line).toBe(3);
  });

  it('TR kalıpları (frontmatter atlanır)', () => {
    const r = load('tr/project');
    expect(kinds(r)).toEqual([
      'package-manager',
      'forbidden-command',
      'forbidden-path',
      'required-command',
      'path-reference',
      'script-reference',
      'unclassified',
      'package-manager',
    ]);
    expect(r[1]?.params.command).toBe('git push');
    expect(r[7]?.params).toEqual({ expected: '', forbidden: 'npm' });
  });
});

describe('audit', async () => {
  const p = dir('en/project');
  const sessions = [
    session('s1', p, [
      bash('npm install'),
      bash('pnpm test'),
      bash('git add . && git commit -m x'),
      bash('git push origin main'),
      edit(`${p}/legacy/a.ts`),
    ]),
    session('s2', p, [bash('pnpm install'), bash('git commit -m y')]),
    session('s3', '/elsewhere', [bash('npm install')]),
  ];
  const res = await auditRules(load('en/project'), sessions, homedir());
  const by = (kind: string, i = 0) => res.filter((r) => r.rule.kind === kind)[i]!;

  it('ihlaller', () => {
    expect(by('package-manager')).toMatchObject({
      status: 'violated',
      violations: 1,
      applicableSessions: 2,
    });
    expect(by('forbidden-command')).toMatchObject({ status: 'violated', violations: 1 });
    expect(by('forbidden-path')).toMatchObject({ status: 'violated', violations: 1 });
    expect(by('required-command')).toMatchObject({
      status: 'violated',
      violations: 1,
      triggeredSessions: 2,
    });
  });

  it('bayatlık', () => {
    expect(by('path-reference')).toMatchObject({ status: 'stale', note: '`src/api/` artık yok' });
    expect(by('script-reference', 0).status).toBe('followed');
    expect(by('script-reference', 1).status).toBe('stale');
  });

  it('analyzer bulguları', () => {
    const ctx = {
      inventory: { tools: [] },
      sessions,
      thresholds: { ...DEFAULT_THRESHOLDS },
      now: NOW,
      audit: res,
    };
    expect(ruleViolations.run(ctx)).toHaveLength(4);
    expect(staleRules.run(ctx).map((f) => f.suggestion)).toContain(
      'Satır 7: `src/api/` artık yok; güncelle veya sil.',
    );
  });

  it('dead-rules: eşik üstü oturumda hiç tetiklenmeyen kural', async () => {
    const many = Array.from({ length: 30 }, (_, i) => session(`d${i}`, p, [bash('ls')]));
    const r = await auditRules(load('en/project'), many, homedir());
    const f = deadRules.run({
      inventory: { tools: [] },
      sessions: many,
      thresholds: { ...DEFAULT_THRESHOLDS },
      now: NOW,
      audit: r,
    });
    expect(f).toHaveLength(1);
    expect(f[0]?.title).toContain('4 kural 30 oturumda');
  });

  it('conflicting-rules: global npm ↔ proje pnpm + tekrar', async () => {
    const rules = [...load('global', 'global'), ...load('en/project')];
    const audit: RuleAuditResult[] = await auditRules(rules, [], homedir());
    const f = conflictingRules.run({
      inventory: { tools: [] },
      sessions: [],
      thresholds: { ...DEFAULT_THRESHOLDS },
      now: NOW,
      audit,
    });
    expect(f.some((x) => x.title.includes('npm ↔ pnpm'))).toBe(true);
    expect(f.some((x) => x.title.startsWith('Tekrar eden kural (forbidden-command)'))).toBe(true);
  });
});
