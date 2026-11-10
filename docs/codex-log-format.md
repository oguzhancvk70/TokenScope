# Codex CLI log format

Source: `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl` (also `~/.codex/archived_sessions/`).

> **Provenance.** `session_meta`, `turn_context`, `message` and `event_msg/user_message` were checked against real files (cli 0.4x, 2025-10). `token_count`, function calls and outputs, `custom_tool_call`, `compacted` and `exec_command_end` follow the open-source `codex-rs` protocol and have **not yet been verified on a real file**. Re-check them when a real session with tool calls is available.

## Line envelope

```json
{ "timestamp": "ISO-8601", "type": "<kind>", "payload": { ... } }
```

Older rollouts (before ~2025-09) have no envelope. The first line is `{id, timestamp, instructions}` and later lines are raw response items. The parser accepts both.

| `type`          | Payload fields used                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_meta`  | `id`, `cwd`, `cli_version`, `instructions` (user instructions / AGENTS.md text), `base_instructions.text`, `source` (`"cli"`, `"exec"`, … or `{subagent: …}`) |
| `turn_context`  | `model`, `cwd` (also `effort`, `approval_policy`, `sandbox_policy`)                                                                                           |
| `response_item` | see below                                                                                                                                                     |
| `event_msg`     | `token_count`, `exec_command_end`, `user_message`, `agent_message`, …                                                                                         |
| `compacted`     | `message`: the context was compacted                                                                                                                          |

## response_item

| `payload.type`                 | Fields                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `message`                      | `role` (`user` / `assistant` / `developer`), `content[] {type: input_text/output_text, text}`       |
| `function_call`                | `name`, `arguments` (JSON **string**), `call_id`                                                    |
| `function_call_output`         | `call_id`, `output`: a string (often JSON `{output, metadata:{exit_code}}`) or `{content, success}` |
| `custom_tool_call` / `_output` | `name` (`apply_patch`), `input` (patch text), `call_id`, `output`                                   |
| `local_shell_call`             | `call_id`, `action {type: exec, command: string[]}`                                                 |
| `reasoning`, `web_search_call` | Content is not read                                                                                 |

Injected context arrives as user/developer messages with markers: `<user_instructions>` / `# AGENTS.md instructions`, `<environment_context>`, `<permissions instructions>`, `<skills_instructions>`.

## token_count

```json
{ "type": "token_count",
  "info": { "total_token_usage": U, "last_token_usage": U, "model_context_window": n } | null,
  "rate_limits": {...} }
U = { input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens }
```

- OpenAI semantics: `input_tokens` **includes** `cached_input_tokens`, and `output_tokens` includes reasoning.
- The same totals can be emitted twice. A turn is counted only when `total_tokens` changes.
- If `last_token_usage` is missing, the turn's usage is the difference in `total_token_usage`.

## Mapping to the common model

| Codex                                                                    | TokenScope                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| each new `token_count`                                                   | `Turn` (`exact: true`; `input = input − cached`, `cacheRead = cached`, `cacheWrite = 0`)          |
| `shell`, `shell_command`, `exec_command`, `local_shell_call`             | `Bash` (`summarizeCommand`); a single `cat/sed/head/tail/nl` command becomes `Read` with its path |
| `apply_patch`                                                            | one `Edit` per `*** Update/Add/Delete File:`                                                      |
| `read_file`, `view_image` / `grep_files` / `list_dir`                    | `Read` / `Grep` / `Glob`                                                                          |
| `mcp__<server>__<tool>` (old: `<server>__<tool>`)                        | `isMcp`, `mcpServer`                                                                              |
| reading `skills/<name>/SKILL.md`                                         | `skillName`                                                                                       |
| non-zero exit code (output metadata, `Exit code: N`, `exec_command_end`) | `isError`                                                                                         |
| `compacted`                                                              | `compactions++`, and the next turn is marked `compacted`                                          |

## Static context (discovery)

- `~/.codex/AGENTS.override.md` or `AGENTS.md` (global), plus `AGENTS.override.md` or `AGENTS.md` in the project root. Nested `AGENTS.md` files are marked as on-demand.
- `~/.codex/skills/**/SKILL.md` (including `.system`) and `<project>/.codex/skills`. Only name + description are counted.
- `[mcp_servers.<name>]` in `~/.codex/config.toml` and `<project>/.codex/config.toml`.
- `~/.codex/memories/**/*.md`.
- Tool schemas are not in the log, so there is no `builtin-tools` / `mcp-tools` size.
