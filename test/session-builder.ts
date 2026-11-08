import type { Session, ToolCall } from '../src/model/types.js';
import { homeRel, summarizeCommand, summarizeCommands } from '../src/util/redact.js';

const call = (name: string, extra: Partial<ToolCall>): ToolCall => ({
  id: Math.random().toString(36).slice(2),
  name,
  inputSize: 10,
  outputSize: 10,
  outputTokensEstimate: 100,
  isError: false,
  isMcp: false,
  ...extra,
});

export const bash = (cmd: string) =>
  call('Bash', { target: summarizeCommand(cmd), commands: summarizeCommands(cmd) });
export const edit = (path: string) => call('Edit', { target: homeRel(path) });
export const read = (path: string) => call('Read', { target: homeRel(path) });

export function session(
  id: string,
  projectPath: string,
  calls: ToolCall[],
  start = '2026-11-01T10:00:00Z',
  opts: { input?: number; instructions?: Record<string, number> } = {},
): Session {
  const at = new Date(start);
  return {
    id,
    tool: 'claude-code',
    projectPath,
    cwds: [projectPath],
    startedAt: at,
    endedAt: new Date(at.getTime() + 3_600_000),
    models: ['claude-sonnet-5-5'],
    isSidechain: false,
    turns: calls.map((c, i) => ({
      index: i,
      messageId: `${id}-${i}`,
      timestamp: at,
      usage: { input: opts.input ?? 1000, output: 100, cacheRead: 0, cacheWrite: 0, exact: true },
      toolCalls: [c],
    })),
    contextSnapshot: Object.entries(opts.instructions ?? {}).map(([name, t]) => ({
      kind: 'instructions-file' as const,
      name,
      chars: t * 4,
      estimatedTokens: t,
    })),
    skillsUsed: [],
    compactions: 0,
    source: { file: `${id}.jsonl` },
  };
}
