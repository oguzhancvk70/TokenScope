import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createClaudeCodeAdapter } from './adapters/claude-code/index.js';
import { emptyStats } from './adapters/types.js';
import { runAnalyzers } from './analyzers/index.js';
import { computeModelAdvice } from './analyzers/model-fit.js';
import { DEFAULT_THRESHOLDS, type Thresholds } from './constants.js';
import { discoverOthers } from './discovery/others.js';
import { annotateUsage, mergeLogMcpServers } from './discovery/usage.js';
import { loadBaselines } from './impact/baseline-store.js';
import { compareEvent, latestComparable } from './impact/compare.js';
import { detectEvents } from './impact/events.js';
import { correlateGit } from './integrations/git.js';
import { gitAi } from './integrations/git-ai.js';
import { createJscpd } from './integrations/jscpd.js';
import type {
  ChangeEvent,
  Comparison,
  DuplicationSummary,
  Finding,
  GitCorrelation,
  InstalledTool,
  Inventory,
  ModelAdvice,
  RuleAuditResult,
  Session,
} from './model/types.js';
import { buildSummary, type ScanSummary } from './report/summary.js';
import { runAudit } from './rules-audit/audit.js';
import { isDir } from './util/fs.js';
import { setHomeForRedaction } from './util/redact.js';

export interface ScanRequest {
  since?: Date;
  project?: string;
  tool?: string;
  redact: boolean;
  thresholds?: Thresholds;
  homeDir?: string;
  analyze?: boolean;
  withJscpd?: boolean;
  // git korelasyonu, olay tespiti ve harici araçlar (testlerde kapatılabilir)
  extras?: boolean;
  now?: Date;
  warn?: (msg: string) => void;
}

export interface ScanResult {
  inventory: Inventory;
  sessions: Session[];
  findings: Finding[];
  modelAdvice: ModelAdvice[];
  summary: ScanSummary;
  audit: RuleAuditResult[];
  duplication: DuplicationSummary[];
  git: GitCorrelation[];
  events: ChangeEvent[];
  impact?: Comparison;
  integrations: { checked: boolean; jscpd: boolean; gitAi: boolean };
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
  const analyze = req.analyze !== false;
  const extras = analyze && req.extras !== false;
  const audit = analyze ? await runAudit(inventory, sessions, home) : [];

  const duplication: DuplicationSummary[] = [];
  const integrations = { checked: extras, jscpd: false, gitAi: false };
  let git: GitCorrelation[] = [];
  let events: ChangeEvent[] = [];
  let impact: Comparison | undefined;
  if (extras) {
    const jscpd = createJscpd(!!req.withJscpd);
    for (const p of project ? [project] : projectPaths) {
      if (!(await isDir(p))) continue;
      if (await jscpd.isAvailable(p)) {
        integrations.jscpd = true;
        const d = await jscpd.collect(p);
        if (d) duplication.push(d);
      }
      if (await gitAi.isAvailable(p)) integrations.gitAi = true;
    }
    git = await correlateGit(sessions);
    events = await detectEvents(inventory, sessions, await loadBaselines(home, project));
    const input = { inventory, sessions, thresholds, now, home };
    const latest = await latestComparable(events, input);
    if (latest) impact = await compareEvent(latest, input);
  }

  const findings = analyze
    ? runAnalyzers({ inventory, sessions, thresholds, now, audit, duplication }, req.warn)
    : [];
  const modelAdvice = analyze ? computeModelAdvice(sessions) : [];
  const stats = wantCC ? cc.stats() : emptyStats();
  return {
    inventory,
    sessions,
    findings,
    modelAdvice,
    summary: buildSummary({ inventory, sessions, findings, since: req.since, now, parse: stats }),
    audit,
    duplication,
    git,
    events,
    impact,
    integrations,
  };
}
