# Claude Code log formatı (gözlem)

> Kaynak: bu makinedeki gerçek dosyalar, 2026-11-08. Claude Code sürümleri `2.1.287 … 2.1.319`, entrypoint `claude-vscode`.
> 54 JSONL dosyası, 39 810 satır, 0 bozuk satır. Sadece yapı; içerik kopyalanmadı.
> Format resmi değil — her alan opsiyonel kabul edilmeli.

## 1. Dosya konumları

| Yol                                                       | İçerik                                                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude/projects/<slug>/<sessionId>.jsonl`             | Ana oturum logu. `<slug>` = cwd'nin `/` → `-` hali (geri çevrilemez: `-` belirsiz; gerçek yol için satırdaki `cwd` kullanılmalı)                         |
| `~/.claude/projects/<slug>/<sessionId>/subagents/*.jsonl` | Subagent (Agent tool) oturumları; satırlarda `isSidechain: true`, `agentId`                                                                              |
| `~/.claude/projects/<slug>/<sessionId>/tool-results/*`    | Büyük tool çıktılarının dışarı yazılmış hali                                                                                                             |
| `~/.claude/projects/<slug>/memory/*.md`                   | Proje belleği (statik bağlam adayı)                                                                                                                      |
| `~/.claude/CLAUDE.md`                                     | Global talimat                                                                                                                                           |
| `~/.claude/settings.json`                                 | `enabledPlugins`, `hooks`, `permissions`, `model`, `modelSettings`                                                                                       |
| `~/.claude.json`                                          | `projects[path].{mcpServers, enabledMcpjsonServers, disabledMcpjsonServers}`, **`skillUsage`**, **`pluginUsage`**, global `mcpServers` (bu makinede boş) |
| `~/.claude/skills/`                                       | Kullanıcı skill'leri (burada `synced/<id>/<skill>/` altında)                                                                                             |
| `~/.claude/plugins/installed_plugins.json`                | `{version, plugins: {"<name>@<marketplace>": …}}`; içerik `plugins/cache/<marketplace>/…`                                                                |
| Proje `.mcp.json`                                         | Bu makinede hiçbir projede yok — adapter yine de okumalı                                                                                                 |

Diğer araçlar: `~/.codex/` var (log `sessions/` yok; SQLite: `logs_2.sqlite` vb.). `~/.gemini`, `~/.cursor`, Cursor `globalStorage` yok.

## 2. Satır türleri (`type`)

Her satır tek JSON nesnesi. Ortak alanlar: `type`, `sessionId`, çoğunda `timestamp` (ISO-8601 UTC, ms), `uuid`, `parentUuid`.

| type                                                                                                                                                          | Adet  | Kullanım                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `assistant`                                                                                                                                                   | 9053  | **Token kaynağı.** `message.usage`, `message.model`, `message.content[]`       |
| `user`                                                                                                                                                        | 5550  | İnsan mesajı veya **tool_result** taşıyıcısı; `toolUseResult`                  |
| `attachment`                                                                                                                                                  | 10896 | Bağlama enjekte edilen ekler — statik bağlam ölçümü buradan                    |
| `api-request`, `api-request-shape`, `api-request-blob`                                                                                                        | ~6k   | İstek iskeleti; `shape.tools[]` tam tool tanımları                             |
| `cost-state`                                                                                                                                                  | 75    | Oturum toplamı: `totalCostUSD`, `modelUsage[model]`, `totalLinesAdded/Removed` |
| `tools-used`                                                                                                                                                  | 51    | `tools: string[]`                                                              |
| `ai-title`, `last-prompt`, `mode`, `queue-operation`, `file-history-*`, `session-owner`, `bridge-session`, `atis-latch`, `frame-link`, `artifact-*`, `system` | —     | Yoksay (sayılır, uyarı vermez)                                                 |

Bilinmeyen `type` → atla, sayaç artır.

## 3. `assistant` satırı

Üst alanlar: `cwd`, `gitBranch`, `version`, `entrypoint`, `isSidechain`, `agentId?`, `requestId`, `timestamp`, `requestedModel?`, `effort?`, `isApiErrorMessage?`, `apiError?`, `attributionSkill?`, `attributionPlugin?`.

`message`: `id`, `model`, `role`, `stop_reason`, `content[]`, `usage`.

**KRİTİK — dedupe:** Bir API yanıtı her içerik bloğu için ayrı satır olarak yazılıyor (1–10+ satır / `message.id`). `usage` bu satırlarda **birebir aynı** (4510 tekrar, 0 fark). Token toplamı `message.id` başına **bir kez** sayılmalı. Bir `Turn` = bir `message.id`.

`message.usage`:

```
input_tokens, output_tokens,
cache_read_input_tokens, cache_creation_input_tokens,
cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens },
iterations[]: { type, input_tokens, output_tokens, cache_read_*, cache_creation_* },
server_tool_use, service_tier, speed, inference_geo, output_tokens_details
```
→ `TokenUsage` eşleşmesi: `input`, `output`, `cacheRead`, `cacheWrite = cache_creation_input_tokens`, `exact: true`.

`content[]` blok türleri: `text`, `thinking`, `tool_use {id, name, input}`.

## 4. Tool çağrısı ve sonucu

- Çağrı: assistant `content[].type == "tool_use"` → `id`, `name`, `input`.
- Sonuç: sonraki `user` satırı, `message.content[].type == "tool_result"` → `tool_use_id`, `content` (string veya blok dizisi), `is_error?` (**sadece ~%53'ünde var; yoksa false**).
- Aynı `user` satırında `toolUseResult` (tool'a özgü yapılandırılmış sonuç) ve `sourceToolUseID`.
- `toolUseResult` string ise hata mesajıdır.

Gözlenen tool'lar: Bash 4111, Edit 1105, Read 1060, Write 476, WebSearch, WebFetch, ToolSearch, Agent, Artifact, TaskStop, AskUserQuestion, Skill, Monitor. MCP çağrısı (`mcp__<server>__<tool>`) bu makinede **yok** — fixture ile test edilmeli.

`target` çıkarımı (input alanları):

| Tool         | input                                                       | target                          |
| ------------ | ----------------------------------------------------------- | ------------------------------- |
| Read         | `file_path`, `offset?`, `limit?`                            | `file_path` (+aralık)           |
| Edit / Write | `file_path`, …                                              | `file_path`                     |
| Bash         | `command`, `description?`, `timeout?`, `run_in_background?` | komutun ilk kelimeleri, redakte |
| Skill        | `skill`                                                     | `skillName`                     |
| Agent        | `description`, `prompt`, `subagent_type`                    | `subagent_type`                 |

`toolUseResult` örnek alanlar: Bash → `stdout, stderr, interrupted, returnCodeInterpretation`; Read → `type, file{…}`; Edit → `filePath, oldString, newString, structuredPatch, originalFile`; sonucu dışarı yazılan çıktıda `contentNotInModelContext`.

`outputSize`: tool_result `content` uzunluğu (bağlama giren kısım). `toolUseResult` daha büyük olabilir, bağlamı temsil etmez.

## 5. Statik bağlam (attachment) — ayırt edici veri

`attachment.type` değerleri ve kullanım:

| attachment.type                                                                | Alanlar                                                              | Kullanım                                                                      |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `instructions`                                                                 | `files[]: {path, type, content}`                                     | Oturuma yüklenen CLAUDE.md vb. — **gerçekten yüklenen** dosyalar ve boyutları |
| `skill_listing`                                                                | `content, names[], skillCount, isInitial`                            | Skill açıklamaları bloğunun boyutu                                            |
| `deferred_tools_record`                                                        | `entries[]: {name, description, input_schema, defer_loading}`        | Ertelenmiş tool (MCP dahil) tanımları                                         |
| `deferred_tools_delta`                                                         | `addedNames, removedNames, failedMcpServers, needsAuthMcpServers, …` | MCP sunucu durumu                                                             |
| `mcp_instructions_delta`                                                       | `addedNames, addedBlocks[]: string`                                  | MCP sunucu talimatları                                                        |
| `agent_listing_delta`                                                          | `addedTypes, builtInTypes, …`                                        | Agent türleri listesi                                                         |
| `prompt_snapshot`                                                              | `systemPrompt[]: string, …`                                          | Sistem prompt'u                                                               |
| `total_tokens_reminder`                                                        | `text` (`<total_tokens>N tokens left</total_tokens>`)                | Kalan bağlam — bağlam büyüklüğü eğrisi için                                   |
| `hook_non_blocking_error`                                                      | `hookName, hookEvent, exitCode, durationMs, …`                       | Hata veren hook'lar (3762 adet!) — ek kural adayı                             |
| `edited_text_file`                                                             | `filename, snippet`                                                  | Dış düzenleme bildirimi                                                       |
| diğer (`environment`, `date`, `model`, `session_context`, `credential_org`, …) | —                                                                    | Yoksay                                                                        |

`api-request-shape.shape.tools[]: {name, description, input_schema}` — o istekte gönderilen tam tool tanımları; karakter sayısından tahmini token.

**Sonuç:** Statik vergi tahmin değil, büyük ölçüde **logdan ölçülebilir** (karakter → `~token`). Kurulum envanteri × bu kayıtlar = gerçek yük.

## 6. Kullanım sayaçları (`~/.claude.json`)

- `skillUsage[name] = {usageCount, lastUsedAt (epoch ms)}`
- `pluginUsage[name] = {usageCount, lastUsedAt, lastUsedNumStartups}`

`dead-weight` için logdaki `Skill` çağrılarıyla birlikte kullanılabilir (loglar silinmiş olsa da sayaç kalır).

## 7. Oturum sınırları ve diğer

- Bir dosya = bir `sessionId`; ama 11 dosyada **birden fazla `cwd`** var (oturum içinde dizin değişimi). `projectPath` = ilk `cwd` (veya en sık); slug'tan türetilmemeli.
- Subagent satırları ayrı dosyada; `Session` ana oturuma bağlanmalı (`parentSessionId`) veya ayrı sayılmalı — çift sayım riski yok (farklı `message.id`).
- Compaction: bu loglarda `isCompactSummary` / compact boundary **görülmedi**. Alan opsiyonel kalsın; tespit kuralı fixture'la desteklenecek.
- `cost-state.totalCostUSD` Claude Code'un kendi hesabı — fiyat tablosuyla çapraz kontrol için kullanılabilir.
- API hataları: `isApiErrorMessage`, `apiErrorStatus`.

## 8. `src/model/types.ts` için değişiklikler (uygulandı)

Ek olarak: `ToolCall.range` (Read offset/limit), `ContextItem.onDemand` (alt dizin CLAUDE.md), `ContextItem.estimateSource` (`file` | `log` | `none`), `InstalledTool.supported`, `Session.contextSnapshot` / `skillsUsed` / `compactions`, `ModelAdvice`.

1. `Turn` = `message.id` başına bir kayıt; `Turn.messageId`, `Turn.requestId` eklensin.
2. `TokenUsage`'a `cacheWrite5m`, `cacheWrite1h` (opsiyonel) eklensin — fiyat farklı.
3. `Session`'a `isSidechain`, `parentSessionId?`, `agentId?`, `cwds: string[]`, `version?`, `costUSD?` (logdaki).
4. `ToolCall`'a `id` (tool_use_id) eklensin — sonuç eşleştirme için.
5. `Session.contextSnapshots?`: `instructions`/`skill_listing`/`deferred_tools`/`mcp_instructions` boyutları (karakter + `~token`), oturum başına.
6. `ContextItemKind`'e `'memory-file'` (proje `memory/`) ve `'hook'` eklensin.
