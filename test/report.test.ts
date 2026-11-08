import { describe, expect, it } from 'vitest';
import { toJson } from '../src/report/json.js';
import { renderInventory, renderScan } from '../src/report/terminal.js';
import { FIXTURE_HOME, scanFixture } from './helpers.js';

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI, '');

describe('reporters', async () => {
  const r = await scanFixture();

  it('terminal: başlık, top bulgular, model önerileri, tablo', () => {
    const out = strip(renderScan(r, { top: 5 }));
    expect(out).toContain('(kesin)');
    expect(out).toContain('En çok israf eden 5 bulgu');
    expect(out).toContain('Model önerileri');
    expect(out).toContain('Araç × proje');
    expect(out).toContain('1 satır atlandı');
  });

  it('inventory çıktısı', () => {
    const out = strip(renderInventory(r));
    expect(out).toContain('statik bağlam envanteri');
    expect(out).toContain('veri yok');
  });

  it('json: ev dizini ~ olur, oturum içeriği yok', () => {
    const json = toJson(r, FIXTURE_HOME);
    const parsed = JSON.parse(json);
    expect(parsed.findings.length).toBe(r.findings.length);
    expect(parsed.sessions).toBeUndefined();
    expect(json.includes(`${FIXTURE_HOME}/`)).toBe(false);
    expect(parsed.modelAdvice.length).toBeGreaterThan(0);
  });
});
