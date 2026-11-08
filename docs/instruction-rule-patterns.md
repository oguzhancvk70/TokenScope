# Instruction rule patterns

How rules are actually written in `CLAUDE.md` / `AGENTS.md` files, and how much of that the deterministic audit patterns cover. Rule texts are not copied here; only the shapes are summarized.

## Sample

A first run on a real machine (1 global `~/.claude/CLAUDE.md` + 5 project files, Turkish and English): **74 rule lines**, of which **29 are checkable (39%)** and **45 unclassified (61%)**.

| Shape seen in practice                                                                             | Share                          | Covered by                                                                   |
| -------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Directory / file map ("`src/app/panel/` — user panel")                                             | most of the checkable lines    | `path-reference`                                                             |
| Behavioral guidance for the agent (scope of reading, answer style, when to stop, reporting format) | most of the unclassified lines | not checkable deterministically                                              |
| Workflow rituals ("at end of day update X, then clean caches")                                     | a few                          | partly `path-reference`; the ritual itself is not checkable                  |
| Tooling constraints (package manager, forbidden / required commands, protected paths)              | rare in this sample            | `package-manager`, `forbidden-command`, `required-command`, `forbidden-path` |

Takeaways:

- Personal global files are dominated by **behavioral rules** ("read narrowly", "write short answers"). They cost tokens in every session but cannot be audited without an LLM; the audit lists them as `unclassified` with their token cost instead of hiding them.
- Project files are dominated by **structure maps**. These go stale easily, so `path-reference` produced the most useful findings (moved files, module names mistaken for paths).
- Command-level rules are the most valuable to audit but the least common. They almost always put the command in backticks, which is what the patterns rely on.

## Pattern design

- First match wins, in order: Turkish patterns, English patterns, `script-reference`, `path-reference`.
- Commands and paths are only taken from backtick spans (or markdown links for paths). Free-text commands like "never run migrations" stay `unclassified`: there is no reliable way to map them to a shell command.
- `required-command` only understands commit / push triggers ("before each commit", "commit öncesi", "`x` çalıştırmadan commit etme").
- Logs keep only `tool subcommand` for each command segment (redaction), so a rule like "never `git push --force`" is reported as untestable instead of matching every `git push`.
- A relative path is reported stale only when its parent directory exists (`next/image` is a module name, not a path). Bare file names are searched anywhere in the project.

## Known false positives

- Paths in "this gets deleted" rules (cache directories) look stale right after the cleanup ran.
- Rules that are intentionally broken on request appear as possible violations; the report says "possible" for that reason.

## Adding a pattern

Add an entry to `src/rules-audit/patterns/en.ts` or `tr.ts`:

```ts
{
  kind: 'forbidden-command',
  re: /\bnever\s+run\s+`([^`]+)`/i,
  params: (m) => ({ command: m[1]! }), // return null to fall through to the next pattern
}
```

Then add a line to the fixtures under `test/fixtures/instructions/` and an expectation in `test/rules-audit.test.ts`.
