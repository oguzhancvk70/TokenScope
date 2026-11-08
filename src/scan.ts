import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createClaudeCodeAdapter } from './adapters/claude-code/index.js';
import { emptyStats } from './adapters/types.js';
import { runAnalyzers } from './analyzers/index.js';
import { computeModelAdvice } from './analyzers/model-fit.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from './constants.js';
import { discoverOthers } from './discovery/others.js';
import { annotateUsage, mergeLogMcpServers } from './discovery/usage.js';
import type { Finding, InstalledTool, Inventory, ModelAdvice, Session } from './model/types.js';
import { buildSummary, type ScanSummary } from './report/summary.js';
import { setHomeForRedaction } from './util/redact.js';

export interface ScanRequest {
  since?: Date;
  project?: string;
  tool?: string;
  redact: boolean;
  thresholds?: Thresholds;
  homeDir?: string;
  analyze?: boolean;
  now?: Date;
  warn?: (msg: string) => void;
}

export interface ScanResult {
  inventory: Inventory;
  sessions: Session[];
  findings: Finding[];
  modelAdvice: ModelAdvice[];
  summary: ScanSummary;
}

const expandHome = (p: string, home: string) =>
  p === '~' || p.startsWith('~/') ? home + p.slice(1) : p;

export async function runScan(req: ScanRequest): Promise<ScanResult> {
  const home = req.homeDir ?? homedir();
  const now = req.now ?? new Date();
  const thresholds = req.thresholds ?? { ...DEFAULT_THRESHOLDS };
  const project = req.project ? resolve(expandHome(req.project, home)) : undefined;
  setHomeForRedaction(home);

  const cc = createClaudeCodeAdapter({ homeDir: home });
  const wantCC = !req.tool || req.tool === cc.id;
  const sessions: Session[] = [];
  if (wantCC) {
    for await (const s of cc.loadSessions({ since: req.since, project, redact: req.redact }))
      sessions.push(s);
  }

  const projectPaths = [
    ...new Set([...sessions.map((s) => s.projectPath), ...(project ? [project] : [])]),
  ].filter((p) => p.startsWith('/') || /^[A-Za-z]:\\/.test(p));
  const tools: InstalledTool[] = [];
  const ccTool = wantCC ? await cc.detect({ projectPaths }) : null;
  if (ccTool) {
    ccTool.version = sessions
      .map((s) => s.version)
      .filter(Boolean)
      .sort()
      .at(-1);
    mergeLogMcpServers(ccTool, sessions);
    annotateUsage(ccTool, sessions, await cc.usageCounters());
    tools.push(ccTool);
  }
  for (const t of await discoverOthers(home)) if (!req.tool || req.tool === t.id) tools.push(t);

  const inventory: Inventory = { tools };
  const findings =
    req.analyze === false ? [] : runAnalyzers({ inventory, sessions, thresholds, now }, req.warn);
  const modelAdvice = req.analyze === false ? [] : computeModelAdvice(sessions);
  const stats = wantCC ? cc.stats() : emptyStats();
  return {
    inventory,
    sessions,
    findings,
    modelAdvice,
    summary: buildSummary({ inventory, sessions, findings, since: req.since, now, parse: stats }),
  };
}
