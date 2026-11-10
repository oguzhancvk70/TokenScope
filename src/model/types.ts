export type ToolId = 'claude-code' | 'codex' | 'gemini-cli' | 'cursor' | (string & {});

export interface Inventory {
  tools: InstalledTool[];
}

export interface InstalledTool {
  id: ToolId;
  version?: string;
  supported: boolean;
  logPaths: string[];
  configPaths: string[];
  contextItems: ContextItem[];
}

export type ContextItemKind =
  | 'instructions-file'
  | 'memory-file'
  | 'skill'
  | 'mcp-server'
  | 'plugin'
  | 'hook'
  | 'system-config';

export type EstimateSource = 'file' | 'log' | 'none';

export interface ContextItem {
  kind: ContextItemKind;
  name: string;
  path: string;
  scope: 'global' | 'project';
  projectPath?: string;
  plugin?: string;
  onDemand?: boolean;
  estimatedTokens: number;
  estimateSource: EstimateSource;
  lastUsedAt?: Date;
  usageCount?: number;
}

// oturuma fiilen giren statik yük (logdan ölçülür)
export type SnapshotKind =
  | 'instructions-file'
  | 'memory-file'
  | 'skill-listing'
  | 'mcp-tools'
  | 'mcp-instructions'
  | 'builtin-tools'
  | 'system-prompt';

export interface ContextSnapshotItem {
  kind: SnapshotKind;
  name: string;
  chars: number;
  estimatedTokens: number;
}

export interface Session {
  id: string;
  tool: ToolId;
  projectPath: string;
  cwds: string[];
  startedAt: Date;
  endedAt: Date;
  models: string[];
  version?: string;
  isSidechain: boolean;
  parentSessionId?: string;
  costUSD?: number;
  turns: Turn[];
  contextSnapshot: ContextSnapshotItem[];
  skillsUsed: string[];
  compactions: number;
  commits?: CommitRef[];
  source: { file: string };
}

export interface Turn {
  index: number;
  messageId: string;
  requestId?: string;
  timestamp: Date;
  model?: string;
  usage: TokenUsage;
  toolCalls: ToolCall[];
  compacted?: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  exact: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  target?: string;
  range?: string;
  inputSize: number;
  outputSize: number;
  outputTokensEstimate: number;
  isError: boolean;
  isMcp: boolean;
  mcpServer?: string;
  skillName?: string;
  // Bash: zincirdeki her komutun redakte özeti ("araç alt-komut")
  commands?: string[];
}

export interface CommitRef {
  sha: string;
  timestamp: Date;
  filesChanged: number;
  insertions: number;
  deletions: number;
  matchConfidence: 'high' | 'low';
}

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
  wastedTokens: number;
  wastedTokensExact: boolean;
  scope: { tool?: ToolId; projectPath?: string; sessionId?: string };
  evidence: string[];
  suggestion: string;
  fix?: FixProposal;
}

export interface ModelOption {
  model: string;
  label: string;
  tier: number;
  costUSD: number;
  savingsUSD: number;
  fit: 'recommended' | 'ok' | 'risky' | 'current';
}

export interface ModelAdvice {
  tool: ToolId;
  projectPath: string;
  sessions: number;
  currentModels: { model: string; share: number }[];
  currentCostUSD: number;
  complexity: { score: number; requiredTier: number; reasons: string[] };
  options: ModelOption[];
  recommended?: ModelOption;
}

export interface FixProposal {
  description: string;
  changes: { path: string; before?: string; after: string }[];
}

// kural uyum denetimi
export type RuleKind =
  | 'package-manager'
  | 'forbidden-path'
  | 'forbidden-command'
  | 'required-command'
  | 'path-reference'
  | 'script-reference'
  | 'unclassified';

export interface InstructionRule {
  id: string;
  kind: RuleKind;
  text: string;
  source: {
    path: string;
    line: number;
    scope: 'global' | 'project';
    projectPath?: string;
    // dosyayı yükleyen araçlar (boşsa hepsi)
    tools?: ToolId[];
  };
  params: Record<string, string>;
  estimatedTokens: number;
}

export type RuleStatus = 'followed' | 'violated' | 'stale' | 'untested' | 'unclassified';

export interface RuleAuditResult {
  rule: InstructionRule;
  status: RuleStatus;
  applicableSessions: number;
  triggeredSessions: number;
  violations: number;
  evidence: string[];
  note?: string;
}

// etki ölçümü
export type ChangeEventKind =
  | 'instructions-edited'
  | 'mcp-added'
  | 'mcp-removed'
  | 'skill-added'
  | 'skill-removed'
  | 'fix-applied'
  | 'manual-baseline';

export interface ChangeEvent {
  at: Date;
  kind: ChangeEventKind;
  path?: string;
  projectPath?: string;
  description: string;
  source: 'log' | 'git' | 'mtime' | 'baseline';
}

export interface PeriodMetrics {
  from: Date;
  to: Date;
  sessions: number;
  avgInput: number;
  medianInput: number;
  avgOutput: number;
  avgCacheRead: number;
  avgStaticContext: number;
  avgToolCallsPerTurn: number;
  findingCounts: Record<string, number>;
  ruleViolationRate?: number;
}

export interface Comparison {
  event: ChangeEvent;
  before: PeriodMetrics;
  after: PeriodMetrics;
  sufficientData: boolean;
  minSessions: number;
}

// harici entegrasyonlar
export interface DuplicationSummary {
  source: 'jscpd';
  projectPath: string;
  percentage: number;
  clones: { files: string[]; lines: number; tokens: number }[];
}

export interface GitCorrelation {
  projectPath: string;
  commits: number;
  matched: number;
  highConfidence: number;
  aiRewriteRatio?: number;
}
