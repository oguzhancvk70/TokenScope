import { createReadStream } from 'node:fs';
import { basename, dirname, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  ContextSnapshotItem,
  Session,
  SnapshotKind,
  TokenUsage,
  ToolCall,
  Turn,
} from '../../model/types.js';
import { estimateTokens, IMAGE_TOKENS } from '../../tokens/estimate.js';
import { arr, isObj, type Json, num, str } from '../../util/fs.js';
import { homeRel, summarizeCommand, urlHost } from '../../util/redact.js';
import type { ParseStats } from '../types.js';

const KNOWN_TYPES = new Set([
  'assistant',
  'user',
  'attachment',
  'api-request-shape',
  'cost-state',
  'system',
  'summary',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'atis-latch',
  'api-request',
  'api-request-blob',
  'last-prompt',
  'ai-title',
  'mode',
  'bridge-session',
  'session-owner',
  'tools-used',
  'artifact-comment-monitor',
  'artifact-autoreact-ledger',
  'frame-link',
]);

const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export const mcpServerOf = (toolName: string): string | undefined =>
  toolName.startsWith('mcp__') ? toolName.split('__')[1] : undefined;

function contentChars(content: unknown): number {
  if (typeof content === 'string') return content.length;
  let n = 0;
  for (const b of arr(content)) {
    if (typeof b === 'string') {
      n += b.length;
      continue;
    }
    if (!isObj(b)) continue;
    if (typeof b.text === 'string') n += b.text.length;
    else if (b.type === 'image') n += IMAGE_TOKENS * 4;
    else n += JSON.stringify(b).length;
  }
  return n;
}

function readUsage(u: unknown): TokenUsage {
  const o = isObj(u) ? u : {};
  const cc = isObj(o.cache_creation) ? o.cache_creation : {};
  return {
    input: num(o.input_tokens),
    output: num(o.output_tokens),
    cacheRead: num(o.cache_read_input_tokens),
    cacheWrite: num(o.cache_creation_input_tokens),
    cacheWrite5m: num(cc.ephemeral_5m_input_tokens),
    cacheWrite1h: num(cc.ephemeral_1h_input_tokens),
    exact: isObj(u),
  };
}

function maxUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    cacheRead: Math.max(a.cacheRead, b.cacheRead),
    cacheWrite: Math.max(a.cacheWrite, b.cacheWrite),
    cacheWrite5m: Math.max(a.cacheWrite5m ?? 0, b.cacheWrite5m ?? 0),
    cacheWrite1h: Math.max(a.cacheWrite1h ?? 0, b.cacheWrite1h ?? 0),
    exact: a.exact || b.exact,
  };
}

class SessionBuilder {
  sessionId?: string;
  version?: string;
  start = Number.POSITIVE_INFINITY;
  end = Number.NEGATIVE_INFINITY;
  cwds: string[] = [];
  turns = new Map<string, Turn>();
  calls = new Map<string, ToolCall>();
  snapshot = new Map<string, ContextSnapshotItem>();
  skills = new Set<string>();
  costByRun = new Map<number, number>();
  compactions = 0;
  pendingCompact = false;
  isSidechain: boolean;

  constructor(
    readonly file: string,
    readonly redact: boolean,
    readonly stats: ParseStats,
  ) {
    this.isSidechain = file.includes(`${sep}subagents${sep}`);
  }

  line(o: Json): void {
    this.sessionId ??= str(o.sessionId);
    const ts = str(o.timestamp);
    if (ts) {
      const t = Date.parse(ts);
      if (!Number.isNaN(t)) {
        this.start = Math.min(this.start, t);
        this.end = Math.max(this.end, t);
      }
    }
    const cwd = str(o.cwd);
    if (cwd && !this.cwds.includes(cwd)) this.cwds.push(cwd);
    this.version = str(o.version) ?? this.version;
    if (o.isSidechain === true) this.isSidechain = true;

    switch (o.type) {
      case 'assistant':
        this.assistant(o);
        return;
      case 'user':
        this.user(o);
        return;
      case 'attachment':
        this.attachment(o);
        return;
      case 'api-request-shape':
        this.shape(o);
        return;
      case 'cost-state':
        this.costByRun.set(num(o.startTime), num(o.totalCostUSD));
        return;
      case 'system':
        if (String(o.subtype ?? '').includes('compact')) this.pendingCompact = true;
        return;
      default:
        if (typeof o.type !== 'string' || !KNOWN_TYPES.has(o.type)) this.stats.unknownTypes++;
    }
  }

  private assistant(o: Json): void {
    const m = isObj(o.message) ? o.message : undefined;
    if (!m) return;
    const model = str(m.model);
    if (model === '<synthetic>' || o.isApiErrorMessage === true) return;
    const id = str(m.id) ?? str(o.requestId) ?? str(o.uuid) ?? `line-${this.turns.size}`;
    const usage = readUsage(m.usage);
    let turn = this.turns.get(id);
    if (!turn) {
      turn = {
        index: 0,
        messageId: id,
        requestId: str(o.requestId),
        timestamp: new Date(str(o.timestamp) ?? 0),
        model,
        usage,
        toolCalls: [],
      };
      if (this.pendingCompact) {
        turn.compacted = true;
        this.compactions++;
        this.pendingCompact = false;
      }
      this.turns.set(id, turn);
    } else {
      turn.usage = maxUsage(turn.usage, usage);
    }
    const attributed = str(o.attributionSkill);
    if (attributed) this.skills.add(attributed);
    for (const b of arr(m.content)) {
      if (isObj(b) && b.type === 'tool_use') this.toolUse(turn, b);
    }
  }

  private toolUse(turn: Turn, b: Json): void {
    const id = str(b.id) ?? `${turn.messageId}#${turn.toolCalls.length}`;
    if (this.calls.has(id)) return;
    const name = str(b.name) ?? 'unknown';
    const input = isObj(b.input) ? b.input : {};
    const call: ToolCall = {
      id,
      name,
      inputSize: JSON.stringify(input).length,
      outputSize: 0,
      outputTokensEstimate: 0,
      isError: false,
      isMcp: name.startsWith('mcp__'),
      mcpServer: mcpServerOf(name),
    };
    if (FILE_TOOLS.has(name)) {
      call.target = homeRel(str(input.file_path) ?? str(input.notebook_path));
      if (name === 'Read' && (input.offset !== undefined || input.limit !== undefined)) {
        call.range = `${num(input.offset)}+${input.limit === undefined ? '' : num(input.limit)}`;
      }
    } else if (name === 'Bash') {
      call.target = summarizeCommand(str(input.command) ?? '', this.redact);
    } else if (name === 'Grep' || name === 'Glob') {
      call.target = homeRel(str(input.path)) ?? (this.redact ? undefined : str(input.pattern));
    } else if (name === 'Skill') {
      call.skillName = str(input.skill);
      call.target = call.skillName;
      if (call.skillName) this.skills.add(call.skillName);
    } else if (name === 'Agent' || name === 'Task') {
      call.target = str(input.subagent_type);
    } else if (name === 'WebFetch') {
      call.target = urlHost(str(input.url));
    }
    turn.toolCalls.push(call);
    this.calls.set(id, call);
  }

  private user(o: Json): void {
    if (o.isCompactSummary === true) this.pendingCompact = true;
    const m = isObj(o.message) ? o.message : undefined;
    for (const b of arr(m?.content)) {
      if (!isObj(b) || b.type !== 'tool_result') continue;
      const call = this.calls.get(str(b.tool_use_id) ?? '');
      if (!call) continue;
      call.outputSize = contentChars(b.content);
      call.outputTokensEstimate = estimateTokens(call.outputSize);
      call.isError = b.is_error === true;
    }
  }

  private snap(kind: SnapshotKind, name: string, chars: number): void {
    if (chars <= 0) return;
    const key = `${kind}|${name}`;
    const prev = this.snapshot.get(key);
    if (!prev || prev.chars < chars) {
      this.snapshot.set(key, { kind, name, chars, estimatedTokens: estimateTokens(chars) });
    }
  }

  private toolGroups(tools: unknown[], deferredAware: boolean): Map<string, number> {
    const groups = new Map<string, number>();
    for (const t of tools) {
      if (!isObj(t)) continue;
      const name = str(t.name) ?? '';
      const chars =
        deferredAware && t.defer_loading === true ? name.length + 2 : JSON.stringify(t).length;
      const g = mcpServerOf(name) ?? '';
      groups.set(g, (groups.get(g) ?? 0) + chars);
    }
    return groups;
  }

  private applyToolGroups(groups: Map<string, number>): void {
    for (const [server, chars] of groups) {
      if (server) this.snap('mcp-tools', server, chars);
      else this.snap('builtin-tools', 'built-in tools', chars);
    }
  }

  private attachment(o: Json): void {
    const a = isObj(o.attachment) ? o.attachment : undefined;
    if (!a) return;
    switch (a.type) {
      case 'instructions':
        for (const f of arr(a.files)) {
          if (!isObj(f)) continue;
          const path = str(f.path) ?? '';
          const kind = path.includes('/memory/') ? 'memory-file' : 'instructions-file';
          this.snap(kind, homeRel(path) ?? path, (str(f.content) ?? '').length);
        }
        return;
      case 'skill_listing':
        this.snap('skill-listing', 'skills', (str(a.content) ?? '').length);
        return;
      case 'deferred_tools_record':
        this.applyToolGroups(this.toolGroups(arr(a.entries), true));
        return;
      case 'mcp_instructions_delta': {
        const names = arr(a.addedNames);
        arr(a.addedBlocks).forEach((block, i) => {
          const name = str(names[i]) ?? 'unknown';
          this.snap('mcp-instructions', name, (str(block) ?? '').length);
        });
        return;
      }
      case 'prompt_snapshot':
        this.snap('system-prompt', 'system prompt', contentChars(a.systemPrompt));
        return;
    }
  }

  private shape(o: Json): void {
    const s = isObj(o.shape) ? o.shape : undefined;
    if (!s) return;
    this.applyToolGroups(this.toolGroups(arr(s.tools), false));
    this.snap('system-prompt', 'system prompt', contentChars(s.system));
  }

  build(): Session | null {
    if (this.turns.size === 0) return null;
    const turns = [...this.turns.values()].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    turns.forEach((t, i) => {
      t.index = i;
    });
    const fileId = basename(this.file, '.jsonl');
    const parent = this.isSidechain ? basename(dirname(dirname(this.file))) : undefined;
    const costs = [...this.costByRun.values()];
    const models = [...new Set(turns.map((t) => t.model).filter((m): m is string => !!m))];
    const first = turns[0]?.timestamp.getTime() ?? 0;
    const last = turns.at(-1)?.timestamp.getTime() ?? 0;
    return {
      id: this.isSidechain ? `${parent ?? this.sessionId}/${fileId}` : (this.sessionId ?? fileId),
      tool: 'claude-code',
      projectPath: this.cwds[0] ?? '(unknown)',
      cwds: this.cwds,
      startedAt: new Date(Number.isFinite(this.start) ? this.start : first),
      endedAt: new Date(Number.isFinite(this.end) ? this.end : last),
      models,
      version: this.version,
      isSidechain: this.isSidechain,
      parentSessionId: parent,
      costUSD: costs.length ? costs.reduce((a, b) => a + b, 0) : undefined,
      turns,
      contextSnapshot: [...this.snapshot.values()],
      skillsUsed: [...this.skills],
      compactions: this.compactions,
      source: { file: this.file },
    };
  }
}

export async function parseSessionFile(
  file: string,
  opts: { redact: boolean },
  stats: ParseStats,
): Promise<Session | null> {
  const b = new SessionBuilder(file, opts.redact, stats);
  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.lines++;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      stats.skippedLines++;
      continue;
    }
    if (!isObj(o)) {
      stats.skippedLines++;
      continue;
    }
    try {
      b.line(o);
    } catch {
      stats.skippedLines++;
    }
  }
  stats.files++;
  return b.build();
}
