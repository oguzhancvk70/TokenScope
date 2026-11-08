# tokenscope

> **Tamamen yerel. Sıfır telemetri. Hiçbir ağ çağrısı yok.**
> Loglarını sadece okur; hiçbir dosyana yazmaz. Fiyat tablosu bile repoda statik JSON olarak durur.
> Raporlarda dosya içeriği, prompt metni ve komut argümanları gösterilmez; yalnızca yol, boyut ve sayılar (`--redact` varsayılan açık).

Bilgisayarındaki AI kodlama araçlarını (Claude Code, Codex, Gemini CLI, Cursor) bulur, skill / MCP / config envanterini çıkarır ve logları analiz ederek şu soruları cevaplar:

1. Tokenlar **nereye** gidiyor? (araç, proje, oturum, tool)
2. Nerede **boşa** gidiyor? (tekrarlı okuma, dev çıktılar, hata döngüleri, kullanılmayan skill/MCP yükü)
3. **Ne yapmalı?** (somut öneri)
4. Bu projeyi **hangi model daha ucuza** bitirebilir? (ör. Opus yerine Sonnet yeterli mi)

## Kurulum

```bash
npx tokenscope
```

Node 20+ gerekir. Kurulum gerektirmez.

## Kullanım

```bash
tokenscope                          # = scan: son 30 gün, envanter + analiz + özet
tokenscope scan --since 7d          # 12h, 2w, 2026-10-01 ...
tokenscope scan --all               # tüm zamanlar
tokenscope scan --project ~/dev/app # tek proje
tokenscope scan --top 20            # daha fazla bulgu
tokenscope scan --json > out.json   # makine okunur çıktı
tokenscope inventory                # kurulu araçlar, skill, MCP, plugin, statik yük
tokenscope scan --config th.json    # eşikleri ez
```

`th.json` örneği:

```json
{ "thresholds": { "hugeOutputTokens": 5000, "deadWeightDays": 14 } }
```

| Eşik                   | Varsayılan | Kural              |
| ---------------------- | ---------- | ------------------ |
| `staticItemWarnTokens` | 2000       | static-context-tax |
| `deadWeightDays`       | 30         | dead-weight        |
| `repeatedReadsMin`     | 3          | repeated-reads     |
| `hugeOutputTokens`     | 10000      | huge-tool-output   |
| `errorLoopMin`         | 3          | error-loops        |

## Örnek çıktı

```
tokenscope · 2026-10-09 → 2026-11-08 · claude-code (44 oturum), codex (veri yok)
Toplam 990.2M token (kesin) · girdi 9.4k · çıktı 4.3M · cache okuma 973.5M · cache yazma 12.4M
~$529 tahmini maliyet · tahmini israf ~273.0k token · sabit yük ~21.6k token/oturum

En çok israf eden 5 bulgu
 1. [MEDIUM] skills (skill listesi) ~4.7k token × 44 oturum ≈ 208.6k
    ~208.6k token · Kullanılmayan skill/plugin'leri kapat ve uzun skill açıklamalarını kısalt.
 2. [LOW] 20 skill 30 gündür kullanılmadı (global olanlar ~2.9k token/oturum)
    ~120.9k token · Kullanmadığın skill'leri kaldır ya da proje bazına (.claude/skills) taşı.
 3. [LOW] `docs-server` MCP'si 30 gündür çağrılmadı, her oturuma ~4.8k token ekliyor
    ~58.2k token · Sunucuyu kapat veya sadece gereken projenin .mcp.json dosyasına taşı.
 ...

Model önerileri (aynı işi daha uygun maliyetle bitirebilecek modeller)
│ Proje   │ Şu anki        │ ~Maliyet │ Gereken       │ Önerilen   │ ~Tasarruf │ Alternatifler                                  │
│ web-app │ opus-5 %88     │ $56.12   │ Sonnet sınıfı │ Sonnet 5.5 │ $31.93    │ Haiku 5.5 $5.24 ? · Sonnet 5.5 $24.19 ✓ · ...   │
│ api     │ opus-5 %62     │ $400     │ Opus sınıfı   │ Opus 5.5   │ $119      │ Sonnet 5.5 $218 ? · Opus 5.5 $282 ✓ · ...       │

Araç × proje
│ Araç        │ Proje   │ Oturum │ Girdi │ Çıktı │ Cache okuma │ Cache yazma │ ~Maliyet │ ~İsraf │
...
```

## Kurallar

| ID                   | Ne tespit eder                                                                                                                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static-context-tax` | Her oturuma hiçbir şey yapılmadan giren yük: CLAUDE.md/AGENTS.md, bellek, skill listesi, MCP şemaları ve talimatları. Claude Code loglarındaki ek kayıtlarından **ölçülür**; log yoksa envanterden tahmin edilir. |
| `dead-weight`        | Kurulu olup son N günde hiç kullanılmayan skill / MCP / plugin ve her oturuma ekledikleri yük                                                                                                                     |
| `huge-tool-output`   | Bağlama giren devasa tool çıktıları (`npm install`, büyük dosya okuması...)                                                                                                                                       |
| `repeated-reads`     | Aynı dosyanın bir oturumda değişmeden tekrar tekrar okunması                                                                                                                                                      |
| `error-loops`        | Aynı komutun/çağrının art arda hata verip yeniden denenmesi                                                                                                                                                       |
| `model-fit`          | Projenin iş yüküne (bağlam boyu, düzenlenen dosya sayısı, tur sayısı, hata oranı) göre yeterli olan en ucuz modeli önerir; aynı token kullanımını alternatif modellerle yeniden fiyatlar                          |

## Dürüst veri

- Logdan gelen token sayıları **kesin**, tahminler `~` ile işaretlidir (statik yük, çıktı boyutu, israf).
- Toplam israfa `static-context-tax` dahil edilmez (`dead-weight` ile çift sayılmasın diye); ayrı satırda gösterilir.
- Verisi okunamayan araçlar için `$0` değil `veri yok` yazılır. v0.1'de yalnızca Claude Code logları analiz edilir; Codex / Gemini CLI / Cursor sadece "kurulu mu" diye tespit edilir.
- Maliyet, `data/pricing.json` içindeki liste fiyatlarıyla tahmin edilir. Model önerileri sezgiseldir: farklı tokenizer veya daha fazla tur ihtiyacı hesaba katılmaz.

## Geliştirme

```bash
npm install
npm run build      # dist/cli.js
npm test           # vitest, test/fixtures altındaki sentetik loglarla
npm run typecheck
npm run lint
```

- Yeni araç desteği: [docs/adding-an-adapter.md](docs/adding-an-adapter.md)
- Yeni kural: [docs/adding-a-rule.md](docs/adding-a-rule.md)
- Claude Code log formatı notları: [docs/claude-code-log-format.md](docs/claude-code-log-format.md)

## Lisans

MIT
