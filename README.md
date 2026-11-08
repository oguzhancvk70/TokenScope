# tokenscope

[![CI](https://github.com/oguzhancvk70/TokenScope/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhancvk70/TokenScope/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![Local-first](https://img.shields.io/badge/local--first-zero%20telemetry-success)
[![Release](https://img.shields.io/github/v/release/oguzhancvk70/TokenScope)](https://github.com/oguzhancvk70/TokenScope/releases)

**Find where your AI coding tokens go, where they're wasted, and which model could do the job for less.**

> **Fully local. Zero telemetry. No network calls.**
> It only reads your logs and never writes to your files. Even the pricing table ships as static JSON in the repo.
> Reports never show file contents, prompt text or command arguments: only paths, sizes and counts (`--redact` is on by default).

tokenscope finds the AI coding tools installed on your machine (Claude Code, Codex, Gemini CLI, Cursor), inventories their skills, MCP servers and config, and analyzes your session logs to answer:

1. **Where** do my tokens go? (by tool, project, session, tool call)
2. Where are they **wasted**? (repeated reads, huge outputs, error loops, unused skills/MCP servers loaded into every session)
3. **What should I change?** (concrete, actionable suggestions)
4. **Which model** could finish this project for less? (e.g. is Sonnet enough instead of Opus?)

## Who is this for?

If you have been working with AI coding assistants for a while, you probably already do most of what tokenscope suggests. You keep your instruction files short, you trim noisy command output, you notice when the agent goes in circles, and you pick a model to match the task. For you, tokenscope is mostly a quick sanity check.

It is most useful if you are **newer to AI-assisted development**, or if you have simply never looked at where your tokens go. Many of the costly habits are invisible from inside a session: a long `CLAUDE.md` loaded into every conversation, MCP servers you installed once and forgot, or the most expensive model used for routine edits. tokenscope makes these visible, puts a number on them, and tells you what to change. Over time you build the same instincts experienced developers rely on.

## Install

Run it straight from GitHub (builds on first run):

```bash
npx github:oguzhancvk70/TokenScope
```

Or from source:

```bash
git clone https://github.com/oguzhancvk70/TokenScope.git
cd TokenScope && npm install
node dist/cli.js
```

Requires Node 20+. An npm release (`npx tokenscope`) is planned.

## Usage

```bash
tokenscope                          # = scan: last 30 days, inventory + analysis + summary
tokenscope scan --since 7d          # 12h, 2w, 2026-10-01 ...
tokenscope scan --all               # all time
tokenscope scan --project ~/dev/app # a single project
tokenscope scan --top 20            # show more findings
tokenscope scan --json > out.json   # machine-readable output
tokenscope inventory                # installed tools, skills, MCP servers, plugins, static load
tokenscope scan --config th.json    # override thresholds
```

Example `th.json`:

```json
{ "thresholds": { "hugeOutputTokens": 5000, "deadWeightDays": 14 } }
```

| Threshold              | Default | Rule               |
| ---------------------- | ------- | ------------------ |
| `staticItemWarnTokens` | 2000    | static-context-tax |
| `deadWeightDays`       | 30      | dead-weight        |
| `repeatedReadsMin`     | 3       | repeated-reads     |
| `hugeOutputTokens`     | 10000   | huge-tool-output   |
| `errorLoopMin`         | 3       | error-loops        |

## Example output

> The terminal output is currently in Turkish. `--json` uses English keys.

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
│ Proje   │ Şu anki    │ ~Maliyet │ Gereken       │ Önerilen   │ ~Tasarruf │ Alternatifler                                 │
│ web-app │ opus-5 %88 │ $56.12   │ Sonnet sınıfı │ Sonnet 5.5 │ $31.93    │ Haiku 5.5 $5.24 ? · Sonnet 5.5 $24.19 ✓ · ... │
│ api     │ opus-5 %62 │ $400     │ Opus sınıfı   │ Opus 5.5   │ $119      │ Sonnet 5.5 $218 ? · Opus 5.5 $282 ✓ · ...     │

Araç × proje
│ Araç        │ Proje   │ Oturum │ Girdi │ Çıktı │ Cache okuma │ Cache yazma │ ~Maliyet │ ~İsraf │
...
```

## Rules

| ID                   | What it detects                                                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static-context-tax` | Load that enters every session before you do anything: CLAUDE.md/AGENTS.md, memory, the skill listing, MCP tool schemas and instructions. **Measured** from Claude Code log attachments; estimated from the inventory when the logs don't have it. |
| `dead-weight`        | Skills, MCP servers and plugins that are installed but unused for N days, and the load they add to every session                                                                                                                                   |
| `huge-tool-output`   | Huge tool outputs entering the context (`npm install`, large file reads, ...)                                                                                                                                                                      |
| `repeated-reads`     | The same file read again and again in one session without changes in between                                                                                                                                                                       |
| `error-loops`        | The same command or call failing and being retried back to back                                                                                                                                                                                    |
| `model-fit`          | Suggests the cheapest model that fits each project's workload (context size, files edited, turns per session, error rate) by re-pricing the same token usage with alternative models                                                               |

## Honest data

- Token counts from logs are **exact**. Estimates are marked with `~` (static load, output size, waste).
- Total waste excludes `static-context-tax` so it isn't double-counted with `dead-weight`; static load is shown on its own line.
- Tools whose data can't be read show `veri yok` ("no data") instead of `$0`. v0.1 analyzes Claude Code logs only. Codex, Gemini CLI and Cursor are only detected as installed.
- Costs are estimated from list prices in `data/pricing.json`. Model suggestions are heuristic: they don't account for tokenizer differences or a cheaper model needing more turns.

## Development

```bash
npm install
npm run build      # dist/cli.js
npm test           # vitest, using synthetic logs under test/fixtures
npm run typecheck
npm run lint
```

- Adding support for a tool: [docs/adding-an-adapter.md](docs/adding-an-adapter.md)
- Adding a rule: [docs/adding-a-rule.md](docs/adding-a-rule.md)
- Notes on the Claude Code log format: [docs/claude-code-log-format.md](docs/claude-code-log-format.md)

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
