import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/constants.js';
import { scanFixture } from './helpers.js';

describe('analyzers', async () => {
  const r = await scanFixture();
  const of = (id: string) => r.findings.filter((f) => f.ruleId === id);

  it('static-context-tax: genel özet + eşiği aşan kalemler', () => {
    const f = of('static-context-tax');
    expect(f.some((x) => x.severity === 'info' && x.title.startsWith('Her oturuma'))).toBe(true);
    expect(f.some((x) => x.title.startsWith('/tmp/demo/CLAUDE.md'))).toBe(true);
    expect(f.some((x) => x.title.startsWith('docs (MCP talimatları)'))).toBe(true);
    expect(f.some((x) => x.title.includes('sistem prompt'))).toBe(false);
  });

  it('dead-weight: kullanılmayan plugin, MCP ve skill', () => {
    const titles = of('dead-weight').map((f) => f.title);
    expect(titles.some((t) => t.includes('`helper` plugin'))).toBe(true);
    expect(
      titles.some((t) => t.includes('`unused-server`') && t.includes('boyut verisi yok')),
    ).toBe(true);
    expect(titles.some((t) => t.startsWith('1 skill'))).toBe(true);
    expect(titles.some((t) => t.includes('`docs`'))).toBe(false);
    expect(titles.some((t) => t.includes('helperdb'))).toBe(false);
  });

  it('huge-tool-output', () => {
    const f = of('huge-tool-output');
    expect(f).toHaveLength(1);
    expect(f[0]?.title).toContain('npm install');
    expect(f[0]?.wastedTokens).toBe(1000);
  });

  it('repeated-reads: düzenlemeye kadar 3 okuma', () => {
    const f = of('repeated-reads');
    expect(f).toHaveLength(1);
    expect(f[0]?.title).toContain('big.ts');
    expect(f[0]?.wastedTokens).toBe(1000);
  });

  it('error-loops: farklı argümanlı aynı komut', () => {
    const f = of('error-loops');
    expect(f).toHaveLength(1);
    expect(f[0]?.title).toContain('npm test');
    expect(f[0]?.title).toContain('3 kez');
  });

  it('varsayılan eşiklerde küçük fixture gürültü üretmez', async () => {
    const d = await scanFixture({ ...DEFAULT_THRESHOLDS });
    expect(d.findings.filter((f) => f.ruleId === 'huge-tool-output')).toHaveLength(0);
  });

  it('model-fit: basit iş yüküne daha ucuz model önerir', () => {
    const demo = r.modelAdvice.find((a) => a.projectPath === '/tmp/demo')!;
    expect(demo.currentModels[0]?.model).toBe('claude-opus-5-5');
    // fixture'da hata oranı yüksek (3/11) → Sonnet sınıfı
    expect(demo.complexity.requiredTier).toBe(2);
    expect(demo.recommended?.model).toBe('claude-sonnet-5-5');
    expect(demo.recommended!.savingsUSD).toBeGreaterThan(0);
    expect(demo.options.find((o) => o.model === 'claude-opus-5-5')?.fit).toBe('current');
    expect(demo.options.find((o) => o.model === 'claude-haiku-5-5')?.fit).toBe('risky');
    expect(of('model-fit').some((f) => f.title.includes('Claude Opus 5.5 yerine Claude Sonnet 5.5'))).toBe(true);

    const other = r.modelAdvice.find((a) => a.projectPath === '/tmp/other')!;
    expect(other.complexity.requiredTier).toBe(1);
    expect(other.recommended?.model).toBe('claude-haiku-5-5');
  });

  it('israf toplamı statik vergiyi içermez', () => {
    const expected = r.findings
      .filter((f) => f.ruleId !== 'static-context-tax')
      .reduce((n, f) => n + f.wastedTokens, 0);
    expect(r.summary.wastedTokens).toBe(expected);
  });
});
