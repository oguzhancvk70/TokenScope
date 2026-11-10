# Gemini CLI log format

Source: `~/.gemini/tmp/<project-slug>/chats/`

> **Provenance.** Extracted from the `ChatRecordingService` and `Storage` / `ProjectRegistry` code in Gemini CLI **0.67.0** (`@google/gemini-cli`, bundled source). No real session file existed on the machine (no login), so this has **not yet been verified on a real file**.

## Files

| Path                                                          | Contents                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| `tmp/<slug>/chats/session-<YYYY-MM-DDTHH-MM>-<shortId>.jsonl` | Main session (current format)                                |
| `tmp/<slug>/chats/<parentSessionId>/<sessionId>.jsonl`        | Subagent session                                             |
| `tmp/<slug>/chats/session-*.json`                             | Legacy format: a single object `{...metadata, messages: []}` |
| `tmp/<slug>/.project_root`                                    | The project's absolute path                                  |
| `~/.gemini/projects.json`                                     | `{ projects: { "<absolute path>": "<slug>" } }`              |

The slug is a short name for new projects. In old versions it is the sha256 of the project path. The runtime directory moves to `~/.cache/.gemini` under the `SANDBOX=sandbox-exec` environment variable; that case is not scanned.

## JSONL lines

1. **Metadata** (first line): `{ sessionId, projectHash, startTime, lastUpdated, kind: "main" | "subagent", directories? }`
2. **Message**: `{ id, timestamp, type, content, displayContent? }`, where `type` ∈ `user | gemini | info | error | warning`.
   - `gemini` messages also have `model`, `thoughts[]`, `tokens`, `toolCalls[]`.
   - **The same `id` is written again** when tokens or tool calls are added later. The last line wins.
3. `{ "$set": {...} }`: metadata update (`lastUpdated`, `summary`, `directories`, `memoryScratchpad`).
4. `{ "$rewindTo": "<messageId>" }`: messages after this point are dropped from the conversation. They were already billed, so TokenScope keeps them.

## tokens

```json
{ "input": promptTokenCount, "output": candidatesTokenCount, "cached": cachedContentTokenCount,
  "thoughts": thoughtsTokenCount, "tool": toolUsePromptTokenCount, "total": totalTokenCount }
```

- Gemini semantics: `input` includes `cached`, and `thoughts` is separate from `output` but billed as output.
- Mapping: `input = input − cached + tool`, `output = output + thoughts`, `cacheRead = cached`, `cacheWrite = 0`, `exact: true`.

## toolCalls[]

`{ id, name, args, result: Part[] (functionResponse.response.output|error), status: success|error|cancelled, timestamp, displayName, description, resultDisplay, agentId? }`

| Gemini                                                        | TokenScope                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `read_file` (`file_path`, `start_line`, `end_line`)           | `Read` + range                                                                            |
| `write_file` / `replace`                                      | `Write` / `Edit`                                                                          |
| `run_shell_command` (`command`)                               | `Bash` (`summarizeCommand`)                                                               |
| `glob`, `list_directory` / `grep_search`                      | `Glob` / `Grep` (`dir_path`)                                                              |
| `web_fetch` (`prompt` contains the URL) / `google_web_search` | `WebFetch` (host) / `WebSearch`                                                           |
| `activate_skill` (`name`)                                     | `Skill`, `skillName`                                                                      |
| `mcp_<server>_<tool>`                                         | `isMcp`; the server is resolved first against known names in settings.json and extensions |
| `status === "error"`                                          | `isError`                                                                                 |

## Not in the log

The system prompt, `GEMINI.md` content and tool schemas are not recorded, so `contextSnapshot` is empty and static load comes from discovery estimates. Compaction (`/compress`) is not recorded as a separate record.

## Static context (discovery)

- `~/.gemini/<context.fileName>` (default `GEMINI.md`, configurable in settings.json), plus the same names in the project root and subdirectories (Gemini loads the whole hierarchy).
- `~/.gemini/skills/**/SKILL.md` and `<project>/.gemini/skills`.
- `mcpServers` in `~/.gemini/settings.json` and `<project>/.gemini/settings.json`.
- `~/.gemini/extensions/<ad>/gemini-extension.json`: a plugin item, plus the extension's `contextFileName`, skills and `mcpServers`.
