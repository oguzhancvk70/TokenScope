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
