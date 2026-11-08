import type { InstructionRule, Session, ToolCall, Turn } from '../../model/types.js';

export interface CheckContext {
  sessions: Session[];
  home: string;
  exists: (path: string) => Promise<boolean>;
  scripts: (dir: string) => Promise<Set<string> | undefined>;
}

export interface CheckOutcome {
  triggered: number;
  violations: number;
  evidence: string[];
  stale?: boolean;
  untestable?: string;
}

export type Check = (rule: InstructionRule, ctx: CheckContext) => Promise<CheckOutcome>;

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export const ref = (s: Session, t: Turn, what: string) =>
  `${s.id.slice(0, 8)} #${t.index}: ${what}`;

export const commandsOf = (c: ToolCall): string[] =>
  c.name === 'Bash' ? (c.commands ?? (c.target ? [c.target] : [])) : [];

export const matchesCommand = (actual: string, wanted: string) =>
  actual === wanted || actual.startsWith(`${wanted} `);

export function* calls(s: Session): Generator<[Turn, ToolCall]> {
  for (const t of s.turns) for (const c of t.toolCalls) yield [t, c];
}

export const MAX_EVIDENCE = 10;
