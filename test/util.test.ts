import { describe, expect, it } from 'vitest';
import { costWithRates, ratesFor, usageCost } from '../src/pricing.js';
import { parseFrontmatter } from '../src/util/frontmatter.js';
import { maskSecrets, summarizeCommand } from '../src/util/redact.js';
import { parseSince } from '../src/util/time.js';

describe('redact', () => {
  it('komutu araç + alt komuta indirger', () => {
    expect(summarizeCommand('npm install --silent')).toBe('npm install');
    expect(summarizeCommand('cd /x && FOO=1 pnpm test -- --watch')).toBe('pnpm test');
    expect(summarizeCommand('/usr/local/bin/python3 -I script.py')).toBe('python3');
    expect(summarizeCommand('curl -H "Authorization: Bearer abc" https://x')).toBe('curl');
  });

  it('secret maskeler', () => {
    expect(maskSecrets('API_KEY=supersecret123 run')).toBe('API_KEY=*** run');
    expect(maskSecrets('token sk-ant-abcdefghijklmnop')).toBe('token ***');
    expect(maskSecrets('https://user:pass@host/x')).toBe('https://user:***@host/x');
    expect(summarizeCommand('git push https://u:p@h', false)).toBe('git push https://u:***@h');
  });
});

describe('time', () => {
  const now = new Date('2026-11-08T00:00:00Z');
  it('süre ve ISO tarih', () => {
    expect(parseSince('30d', now).toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(parseSince('12h', now).toISOString()).toBe('2026-11-07T12:00:00.000Z');
    expect(parseSince('2026-01-01').getUTCFullYear()).toBe(2026);
    expect(() => parseSince('yesterday')).toThrow();
  });
});

describe('frontmatter', () => {
  it('düz, tırnaklı ve çok satırlı değerler', () => {
    expect(parseFrontmatter('---\nname: a\ndescription: "b c"\n---\n')).toEqual({
      name: 'a',
      description: 'b c',
    });
    expect(parseFrontmatter('---\ndescription: |\n  x\n  y\nname: z\n---').description).toBe('x y');
    expect(parseFrontmatter('no frontmatter')).toEqual({});
  });
});

describe('pricing', () => {
  const u = { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0, exact: true };
  it('önek eşleşmesi ve bilinmeyen model', () => {
    expect(ratesFor('claude-opus-5-5')?.input).toBe(4);
    expect(ratesFor('claude-opus-5')?.input).toBe(5);
    expect(ratesFor('claude-haiku-4-5-20251001')?.input).toBe(1);
    expect(usageCost('gpt-x', u)).toBeUndefined();
    expect(usageCost('claude-sonnet-5-5', u)).toBe(12);
  });
  it('Haiku 5.5 uzun bağlam fiyatı', () => {
    const r = ratesFor('claude-haiku-5-5')!;
    expect(costWithRates(r, { ...u, input: 50_000, output: 0 })).toBeCloseTo(0.005);
    expect(costWithRates(r, { ...u, input: 200_000, output: 0 })).toBeCloseTo(0.1);
  });
});
