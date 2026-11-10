import type { ParseStats } from '../adapters/types.js';
import type { Finding, Inventory, Session, ToolId } from '../model/types.js';
import { usageCost } from '../pricing.js';

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface ProjectRow {
  tool: ToolId;
  projectPath: string;
  sessions: number;
  tokens: TokenTotals;
  estCostUSD?: number;
  wastedTokens: number;
}

export interface ScanSummary {
  since?: string;
  until: string;
  tools: {
    id: ToolId;
    supported: boolean;
    sessions: number;
    tokens: TokenTotals;
    estCostUSD?: number;
    wastedTokens: number;
    findings: number;
  }[];
  sessions: number;
  subagentSessions: number;
  tokens: TokenTotals;
  tokensExact: boolean;
  estCostUSD?: number;
  loggedCostUSD?: number;
  unpricedModels: string[];
  wastedTokens: number;
  staticTokensPerSession: number;
  findings: number;
  projects: ProjectRow[];
  parse: ParseStats;
}

// statik vergi israf toplamına girmez (dead-weight ile çakışmasın diye)
const COUNTS_AS_WASTE = (f: Finding) => f.ruleId !== 'static-context-tax';

const zero = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

function addUsage(t: TokenTotals, s: Session): void {
  for (const turn of s.turns) {
    const u = turn.usage;
    t.input += u.input;
    t.output += u.output;
    t.cacheRead += u.cacheRead;
    t.cacheWrite += u.cacheWrite;
    t.total += u.input + u.output + u.cacheRead + u.cacheWrite;
  }
}

export function buildSummary(args: {
  inventory: Inventory;
  sessions: Session[];
  findings: Finding[];
  since?: Date;
  now: Date;
  parse: ParseStats;
}): ScanSummary {
  const { sessions, findings } = args;
  const tokens = zero();
  const unpriced = new Set<string>();
  let est = 0;
  let priced = false;
  let logged = 0;
  let hasLogged = false;
  const rows = new Map<string, ProjectRow>();

  for (const s of sessions) {
    addUsage(tokens, s);
    const key = `${s.tool}|${s.projectPath}`;
    const row = rows.get(key) ?? {
      tool: s.tool,
      projectPath: s.projectPath,
      sessions: 0,
      tokens: zero(),
      wastedTokens: 0,
    };
    if (!s.isSidechain) row.sessions++;
    addUsage(row.tokens, s);
    for (const t of s.turns) {
      const c = usageCost(t.model, t.usage);
      if (c === undefined) {
        if (t.model) unpriced.add(t.model);
        continue;
      }
      est += c;
      priced = true;
      row.estCostUSD = (row.estCostUSD ?? 0) + c;
    }
    if (!s.isSidechain && s.costUSD !== undefined) {
      logged += s.costUSD;
      hasLogged = true;
    }
    rows.set(key, row);
  }

  const waste = findings.filter(COUNTS_AS_WASTE);
  for (const f of waste) {
    if (!f.scope.projectPath) continue;
    for (const row of rows.values())
      if (row.projectPath === f.scope.projectPath && (!f.scope.tool || row.tool === f.scope.tool))
        row.wastedTokens += f.wastedTokens;
  }

  const main = sessions.filter((s) => !s.isSidechain);
  const measured = main.filter((s) => s.contextSnapshot.length);
  const staticTotal = measured.reduce(
    (n, s) => n + s.contextSnapshot.reduce((m, c) => m + c.estimatedTokens, 0),
    0,
  );

  return {
    since: args.since?.toISOString(),
    until: args.now.toISOString(),
    tools: args.inventory.tools.map((t) => {
      const own = [...rows.values()].filter((r) => r.tool === t.id);
      const tk = zero();
      for (const r of own)
        for (const k of Object.keys(tk) as (keyof TokenTotals)[]) tk[k] += r.tokens[k];
      const costs = own.map((r) => r.estCostUSD).filter((c): c is number => c !== undefined);
      const fs = findings.filter((f) => f.scope.tool === t.id);
      return {
        id: t.id,
        supported: t.supported,
        sessions: main.filter((s) => s.tool === t.id).length,
        tokens: tk,
        estCostUSD: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
        wastedTokens: fs.filter(COUNTS_AS_WASTE).reduce((n, f) => n + f.wastedTokens, 0),
        findings: fs.length,
      };
    }),
    sessions: main.length,
    subagentSessions: sessions.length - main.length,
    tokens,
    tokensExact: sessions.every((s) => s.turns.every((t) => t.usage.exact)),
    estCostUSD: priced ? est : undefined,
    loggedCostUSD: hasLogged ? logged : undefined,
    unpricedModels: [...unpriced],
    wastedTokens: waste.reduce((n, f) => n + f.wastedTokens, 0),
    staticTokensPerSession: measured.length ? staticTotal / measured.length : 0,
    findings: findings.length,
    projects: [...rows.values()].sort((a, b) => b.tokens.total - a.tokens.total),
    parse: args.parse,
  };
}
