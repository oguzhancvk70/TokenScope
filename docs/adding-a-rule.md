# Yeni kural (analyzer) eklemek

Yeni tespit = yeni analyzer dosyası.

## 1. Dosya

`src/analyzers/<rule-id>.ts`:

```ts
import type { Analyzer } from './types.js';
import { severityFor } from './util.js';

export const myRule: Analyzer = {
  id: 'my-rule',
  description: 'Tek cümle: ne tespit eder',
  run({ sessions, inventory, thresholds, now }) {
    return [
      {
        ruleId: 'my-rule',
        severity: severityFor(wasted),
        title: 'Kısa, tek satır',
        detail: 'Ne oldu, nerede',
        wastedTokens: wasted,
        wastedTokensExact: false,
        scope: { projectPath },
        evidence: ['redakte referanslar'],
        suggestion: 'Somut öneri',
      },
    ];
  },
};
```

## 2. Eşikler

Kural eşiği kullanıcı tarafından ayarlanabilir olmalıysa:

1. `src/constants.ts` → `DEFAULT_THRESHOLDS` içine ekle.
2. `src/config.ts` → `ThresholdSchema` içine ekle (`--config` ile ezilebilsin).

Kurala özel, ayarlanması gerekmeyen sabitler dosyanın başında durur.

## 3. Kayıt

`src/analyzers/index.ts` → `ANALYZERS` dizisine ekle. Bulgular `wastedTokens`'a göre sıralanır; ilk 5'i terminalde görünür.

## 4. Test

`test/fixtures/claude-code/` altındaki sentetik loglara bu deseni üreten satırlar ekle (üretici betik içerik kopyalamaz; yer tutucu karakter kullanır) ve `test/analyzers.test.ts` içine bir `it(...)` yaz. Küçük fixture için eşikleri testte düşür (`test/helpers.ts` → `LOW_THRESHOLDS`).

## İlkeler

- Tahmini değerler `wastedTokensExact: false`.
- `evidence` içinde dosya içeriği, prompt veya komut argümanı olmaz.
- Veri yoksa bulgu üretme ya da `veri yok` de; asla `0` ile sessizce geçme.
