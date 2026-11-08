# tokenscope

[![CI](https://github.com/oguzhancvk70/TokenScope/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhancvk70/TokenScope/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![Local-first](https://img.shields.io/badge/local--first-zero%20telemetry-success)
[![Release](https://img.shields.io/github/v/release/oguzhancvk70/TokenScope)](https://github.com/oguzhancvk70/TokenScope/releases)

**Find where your AI coding tokens go, where they're wasted, and which model could do the job for less.**

> **Fully local. Zero telemetry. No network calls.**
> It only reads your logs and never writes to your project files. The one place it writes is `~/.tokenscope/baselines/` when you run `tokenscope baseline` (numbers and names only, no content). Even the pricing table ships as static JSON in the repo.
> Reports never show file contents, prompt text or command arguments: only paths, sizes and counts (`--redact` is on by default).

tokenscope finds the AI coding tools installed on your machine (Claude Code, Codex, Gemini CLI, Cursor), inventories their skills, MCP servers and config, and analyzes your session logs to answer:

1. **Where** do my tokens go? (by tool, project, session, tool call)
2. Where are they **wasted**? (repeated reads, huge outputs, error loops, unused skills/MCP servers loaded into every session)
3. **What should I change?** (concrete, actionable suggestions)
4. **Which model** could finish this project for less? (e.g. is Sonnet enough instead of Opus?)
5. Does the agent actually **follow my CLAUDE.md / AGENTS.md rules**? Which rules are stale, dead or contradict each other?
6. Did my last change (shorter CLAUDE.md, removed MCP server) **actually help**? Before/after numbers, not guesses.

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
tokenscope scan --with-jscpd        # run jscpd (if installed) and add duplicate-code data

tokenscope audit                    # rule compliance report for CLAUDE.md / AGENTS.md
tokenscope audit --all-rules        # also list up-to-date references and every unchecked line
tokenscope events                   # detected changes (instruction edits, MCP/skill changes, baselines)
tokenscope baseline --note "before" # snapshot current metrics to ~/.tokenscope/baselines
tokenscope compare                  # before/after the most recent change event
tokenscope compare --since 3        # ... around event #3 from `tokenscope events`
tokenscope compare --since 2026-11-01
```

`audit`, `events` and `baseline` accept the same `--since / --all / --project / --tool / --json / --config` options as `scan`. `compare` always looks at all sessions so both sides of the event have data.

Example `th.json`:

```json
{ "thresholds": { "hugeOutputTokens": 5000, "deadWeightDays": 14 } }
```

| Threshold              | Default | Rule                                                  |
| ---------------------- | ------- | ----------------------------------------------------- |
| `staticItemWarnTokens` | 2000    | static-context-tax                                    |
| `deadWeightDays`       | 30      | dead-weight                                           |
| `repeatedReadsMin`     | 3       | repeated-reads                                        |
| `hugeOutputTokens`     | 10000   | huge-tool-output                                      |
| `errorLoopMin`         | 3       | error-loops                                           |
| `deadRuleMinSessions`  | 30      | dead-rules                                            |
| `impactMinSessions`    | 10      | compare / impact line (minimum sessions on each side) |

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

| ID                                                                  | What it detects                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static-context-tax`                                                | Load that enters every session before you do anything: CLAUDE.md/AGENTS.md, memory, the skill listing, MCP tool schemas and instructions. **Measured** from Claude Code log attachments; estimated from the inventory when the logs don't have it. |
| `dead-weight`                                                       | Skills, MCP servers and plugins that are installed but unused for N days, and the load they add to every session                                                                                                                                   |
| `huge-tool-output`                                                  | Huge tool outputs entering the context (`npm install`, large file reads, ...)                                                                                                                                                                      |
| `repeated-reads`                                                    | The same file read again and again in one session without changes in between                                                                                                                                                                       |
| `error-loops`                                                       | The same command or call failing and being retried back to back                                                                                                                                                                                    |
| `model-fit`                                                         | Suggests the cheapest model that fits each project's workload (context size, files edited, turns per session, error rate) by re-pricing the same token usage with alternative models                                                               |
| `rule-violations`, `stale-rules`, `dead-rules`, `conflicting-rules` | Instruction file compliance, see [Rule compliance audit](#rule-compliance-audit-tokenscope-audit)                                                                                                                                                  |
| `duplicate-code`                                                    | Files with duplicated code (jscpd) and how many tokens reading them cost, see [Integrations](#integrations-jscpd-git-ai)                                                                                                                           |

## Rule compliance audit (`tokenscope audit`)

Instruction files are supposed to steer the agent, but nothing tells you whether they do. `audit` reads every `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `AGENTS.md` that tokenscope discovers (global and per project), splits them into rules (one bullet, numbered item or paragraph line each) and checks them against your session logs and your disk.

Rules are classified with **deterministic patterns in English and Turkish**, no LLM involved. Patterns live in `src/rules-audit/patterns/` (`en.ts`, `tr.ts`), so adding a new phrasing is a one-line change.

| Rule kind           | Example phrasing                                                            | How it is checked                                                                  |
| ------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `package-manager`   | "Always use pnpm", "pnpm kullan", "npm kullanma"                            | Bash calls that use a forbidden package manager                                    |
| `forbidden-command` | "Never run `git push`", "`git push` yapma"                                  | Bash calls matching the command (every segment of `a && b; c` is checked)          |
| `forbidden-path`    | "Do not edit `legacy/`", "`legacy/` klasörüne dokunma"                      | Edit / Write / MultiEdit / NotebookEdit targets inside that path                   |
| `required-command`  | "Before each commit, run `pnpm test`", "Commit öncesi `pnpm test` çalıştır" | Each `git commit` / `git push` must be preceded by the command in the same session |
| `path-reference`    | "API code lives in `src/api/`"                                              | Does the path still exist on disk? (bare file names are searched in the project)   |
| `script-reference`  | "Check with `pnpm run lint`"                                                | Does the script exist in `package.json`?                                           |
| `unclassified`      | free text                                                                   | Not checked; only its token cost is reported                                       |

Each rule ends up in one of these states:

- **olası ihlal** (possible violation): the logs show the forbidden action. It is a _possible_ violation because you may have told the agent to do it.
- **bayat** (stale): it points to a path or script that no longer exists.
- **uyuluyor / güncel** (followed / up to date).
- **tetiklenmedi** (never triggered): the rule's subject (a package manager command, an edit, a commit) never came up, so compliance can't be measured. Rules with arguments that redaction strips (e.g. `git push --force`) are also reported here with a note.
- **sınıflanamadı** (unclassified): listed separately with their token cost, so you can see what is _not_ being audited.

Four analyzers turn the audit into normal findings, which also show up in `tokenscope scan` (at least one audit finding is kept in the top list even though it carries no token waste):

| ID                  | What it reports                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `rule-violations`   | Most-violated rules with evidence (`session #turn: command`, redacted) and a fix hint (hook, `permissions.deny`) |
| `stale-rules`       | Stale references with file and line ("line 14: `src/api/` no longer exists; update or delete")                   |
| `dead-rules`        | Checkable rules that never triggered in `deadRuleMinSessions`+ sessions, with their per-session token cost       |
| `conflicting-rules` | Contradictions (global says npm, project says pnpm; a command both required and forbidden) and duplicated rules  |

## Impact measurement (`baseline` / `events` / `compare`)

Most tools stop at "here is the problem". tokenscope also measures whether your fix worked.

**Change events** are detected automatically, without any setup:

- **Logs:** Claude Code records the size of each instruction file loaded into a session. When that size changes between sessions, that's an `instructions-edited` event with the exact before/after size (e.g. `CLAUDE.md 6.1k → 2.3k token`).
- **Git history** of instruction files, or the file's **mtime** if it isn't in a repository.
- **Baselines:** `tokenscope baseline` stores current metrics plus the list of MCP servers and skills. Differences between consecutive baselines become `mcp-added`, `mcp-removed`, `skill-added` and `skill-removed` events.

`tokenscope compare` splits sessions at the event (only the affected project's sessions for project-level events) and compares, per session: average and median input, output, cache reads, static context load, tool calls per turn, finding counts per rule and rule violations per session.

Honesty rules:

- Each side needs at least `impactMinSessions` (default 10) sessions, otherwise you get `Henüz yeterli veri yok (4/10 oturum)` instead of numbers.
- Mean and median are shown together so a single outlier session can't fake a trend.
- The report uses correlation language ("dropped", "went up") and reminds you that sessions vary by kind of work. It never claims a change _caused_ the difference.

`tokenscope scan` adds one line at the end when there is enough data, e.g. `Son değişiklikten (CLAUDE.md, 3 gün önce) bu yana: oturum başına input −%12 (n=18)`.

## Integrations (jscpd, Git AI)

tokenscope does not bundle or install these tools. If they are already on your machine or in your project it reads their output; otherwise `scan` prints a one-line hint. No network calls either way.

- **[jscpd](https://github.com/kucherenko/jscpd)** (duplicate code): an existing report (`report/jscpd-report.json`, `.jscpd/jscpd-report.json`, `jscpd-report.json`) is read automatically. With `--with-jscpd`, tokenscope runs `jscpd` from `node_modules/.bin` or your `PATH`, respecting `.jscpd.json`, and writes the report to a temp directory, never into your project. The `duplicate-code` finding then correlates clones with your logs: "these 3 files with duplicated code were read 47 times, ~210k tokens".
- **Git AI** (AI blame): if the repository has `refs/notes/ai`, tokenscope reads the notes directly with `git log --notes=ai` (the Git AI CLI isn't needed). Commits are linked to sessions by the session id in the note (**high** confidence), and the share of AI-written lines that were later rewritten is reported.
- Without Git AI, commits are matched to sessions by time window (session start/end ±10 min, **low** confidence). `scan` prints a one-line summary such as `Git: 4 projede 22/23 commit oturumlarla eşleşti (zaman aralığına göre tahmini)`.

## Honest data

- Token counts from logs are **exact**. Estimates are marked with `~` (static load, output size, waste).
- Total waste excludes `static-context-tax` so it isn't double-counted with `dead-weight`; static load is shown on its own line.
- Rule compliance is reported as _possible_ violations, never as a verdict. Command evidence is redacted to `tool subcommand`.
- Before/after comparisons need enough sessions on both sides and are described as correlation, not causation.
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
- How instruction rules are written in practice and what the audit patterns cover: [docs/instruction-rule-patterns.md](docs/instruction-rule-patterns.md)

Contributions welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
