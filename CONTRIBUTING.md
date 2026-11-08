# Contributing

Thanks for helping make AI-assisted coding cheaper and more transparent.

## Setup

```bash
git clone https://github.com/oguzhancvk70/TokenScope.git
cd TokenScope
npm install        # also builds dist/
npm test
node dist/cli.js
```

## Good first contributions

- **New adapter** (Codex, Gemini CLI, Cursor): see [docs/adding-an-adapter.md](docs/adding-an-adapter.md)
- **New rule**: see [docs/adding-a-rule.md](docs/adding-a-rule.md)
- **Pricing**: add models to `data/pricing.json`
- **English terminal output**: the CLI currently prints Turkish

## Ground rules

- No network calls, ever. No telemetry.
- Read-only during analysis.
- Never commit real logs. Fixtures must be synthetic (real structure, placeholder content).
- Mark estimates as estimates (`~`, `wastedTokensExact: false`).
- Run `npm run lint && npm run typecheck && npm test` before opening a PR.
