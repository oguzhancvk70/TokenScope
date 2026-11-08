# Yeni adapter eklemek

Yeni araç = yeni adapter. Çekirdeğe dokunmadan eklenir.

## 1. Önce gerçek dosyaları incele

Log formatlarını varsayma. Makinedeki gerçek dosyaların **yapısını** (alan adları, tipler; içerik değil) çıkar ve `docs/<tool>-log-format.md` dosyasına yaz. Örnek: [claude-code-log-format.md](claude-code-log-format.md).

## 2. Arayüz

`src/adapters/types.ts`:

```ts
interface Adapter {
  id: ToolId;
  detect(opts?: { projectPaths?: string[] }): Promise<InstalledTool | null>;
  loadSessions(opts: LoadOptions): AsyncIterable<Session>;
  stats(): ParseStats;
}
```

- `detect`: araç kurulu değilse `null`. Kuruluysa log/config yolları ve statik bağlam kalemleri (`ContextItem[]`).
- `loadSessions`: oturumları ortak modele (`src/model/types.ts`) çevirir.

## 3. Kurallar

- **Stream oku** (`readline`); dosyayı belleğe tümüyle alma.
- **Toleranslı parse:** bozuk satır → `stats.skippedLines++`, bilinmeyen tür → `stats.unknownTypes++`; asla çökme.
- **Kesin / tahmini ayrımı:** logdan gelen usage için `exact: true`; tahminler `estimateTokens()` (`src/tokens/estimate.ts`).
- **Redaksiyon:** hedefleri `homeRel()` ve `summarizeCommand()` (`src/util/redact.ts`) ile üret; içerik ve prompt metni modele girmez.
- Tekrarlanan kayıtlar (ör. aynı API yanıtının birden fazla satırı) bir kez sayılmalı.

## 4. Bağlama

1. `src/adapters/<tool>/index.ts` + `parse.ts`
2. `src/scan.ts` içinde adapter'ı listeye ekle; `src/discovery/others.ts` içindeki "veri yok" kaydını kaldır (`supported: true`).
3. Anonimleştirilmiş fixture: `test/fixtures/<tool>/` (sentetik içerik, gerçek yapı).
4. `test/<tool>-adapter.test.ts`.
