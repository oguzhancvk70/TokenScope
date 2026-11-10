import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import type {
  ContextSnapshotItem,
  Session,
  SnapshotKind,
  TokenUsage,
  ToolCall,
  Turn,
} from '../../model/types.js';
import { estimateTokens } from '../../tokens/estimate.js';
import { arr, isObj, type Json, num, str } from '../../util/fs.js';
import { homeRel, summarizeCommand, summarizeCommands, urlHost } from '../../util/redact.js';
import type { ParseStats } from '../types.js';

const KNOWN_TYPES = new Set([
  'session_meta',
  'response_item',
  'event_msg',
  'turn_context',
  'compacted',
]);
const ITEM_TYPES = new Set([
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'local_shell_call',
  'web_search_call',
]);
const SHELL_TOOLS = new Set([
  'shell',
  'shell_command',
  'exec_command',
  'local_shell',
  'container.exec',
]);
const READ_CMDS = new Set(['cat', 'nl', 'head', 'tail', 'sed', 'less', 'bat']);
const SHELLS = /^(?:\/\S*\/)?(?:ba|z|da)?sh$/;

// Codex MCP adları: mcp__server__tool (eski sürümler: server__tool)
export const codexMcpServer = (name: string): string | undefined => {
  if (!name.includes('__')) return undefined;
  const parts = name.split('__');
  return parts[0] === 'mcp' ? parts[1] : parts[0];
};

function parseArgs(v: unknown): Json {
  if (isObj(v)) return v;
  if (typeof v !== 'string') return {};
  try {
    const o = JSON.parse(v);
    return isObj(o) ? o : {};
  } catch {
    return {};
  }
}

// ["bash","-lc","..."] → "..."
function commandText(v: unknown): string {
  if (typeof v === 'string') return v;
  const a = arr(v).filter((x): x is string => typeof x === 'string');
  if (a.length >= 3 && SHELLS.test(a[0] ?? '') && /^-\w*c$/.test(a[1] ?? '')) return a[2] ?? '';
  return a.join(' ');
}

// tek parça dosya okuma komutu → okunan yol
function readTarget(cmd: string): string | undefined {
  if (/&&|\|\||;|\||\n|>/.test(cmd)) return undefined;
  const words = cmd.trim().split(/\s+/);
  if (!READ_CMDS.has(words[0] ?? '')) return undefined;
  const file = words
    .slice(1)
    .filter((w) => !w.startsWith('-') && !/^['"]?\d+(,\d+)?p?['"]?$/.test(w))
    .at(-1);
  return file?.replace(/^['"]|['"]$/g, '');
}

function outputText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isObj(v)) return str(v.content) ?? JSON.stringify(v);
  return v === undefined ? '' : JSON.stringify(v);
}

function outputFailed(v: unknown): boolean {
  if (isObj(v) && v.success === false) return true;
  const text = outputText(v);
  const o = parseArgs(text);
  const meta = isObj(o.metadata) ? o.metadata : undefined;
  if (meta && typeof meta.exit_code === 'number') return meta.exit_code !== 0;
  const m = /^(?:Exit code|Process exited with code):?\s*(-?\d+)/m.exec(text.slice(0, 400));
  return m ? m[1] !== '0' : false;
}

function readUsage(u: Json): TokenUsage {
  const input = num(u.input_tokens);
  const cached = num(u.cached_input_tokens);
  return {
    input: Math.max(0, input - cached),
    output: num(u.output_tokens),
    cacheRead: cached,
    cacheWrite: 0,
    exact: true,
  };
}

const diff = (a: Json, b: Json): Json => {
  const out: Json = {};
  for (const k of ['input_tokens', 'cached_input_tokens', 'output_tokens', 'total_tokens'])
    out[k] = Math.max(0, num(a[k]) - num(b[k]));
  return out;
};

class SessionBuilder {
  sessionId?: string;
  version?: string;
  model?: string;
  isSidechain = false;
  parent?: string;
  start = Number.POSITIVE_INFINITY;
  end = Number.NEGATIVE_INFINITY;
  cwds: string[] = [];
  turns: Turn[] = [];
  pending: ToolCall[] = [];
  calls = new Map<string, ToolCall>();
  snapshot = new Map<string, ContextSnapshotItem>();
  skills = new Set<string>();
  lastTotal?: Json;
  compactions = 0;
  pendingCompact = false;
  ts = 0;

  constructor(
    readonly file: string,
    readonly redact: boolean,
    readonly stats: ParseStats,
  ) {}

  line(o: Json) {
    const t = Date.parse(str(o.timestamp) ?? '');
    if (!Number.isNaN(t)) {
      this.ts = t;
      this.start = Math.min(this.start, t);
      this.end = Math.max(this.end, t);
    }
    const type = str(o.type);
    // eski format: sarmalayıcı yok
    if (!isObj(o.payload)) {
      if (type && ITEM_TYPES.has(type)) return this.item(o);
      if (!type && str(o.id)) return this.meta(o);
      this.stats.unknownTypes++;
      return;
    }
    const p = o.payload;
    if (type === 'session_meta') this.meta(p);
    else if (type === 'turn_context') this.context(p);
    else if (type === 'response_item') this.item(p);
    else if (type === 'event_msg') this.event(p);
    else if (type === 'compacted') {
      this.compactions++;
      this.pendingCompact = true;
    } else if (!KNOWN_TYPES.has(type ?? '')) this.stats.unknownTypes++;
  }

  private cwd(c: string | undefined): void {
    if (c && !this.cwds.includes(c)) this.cwds.push(c);
  }

  private meta(p: Json): void {
    if (this.sessionId) return;
    this.sessionId = str(p.id);
    this.version = str(p.cli_version);
    this.cwd(str(p.cwd));
    const src = p.source;
    if (isObj(src) && 'subagent' in src) {
      this.isSidechain = true;
      this.parent = str(p.forked_from_id) ?? str(p.parent_id);
    }
    this.snap('instructions-file', 'user_instructions', (str(p.instructions) ?? '').length);
    const base = p.base_instructions;
    this.snap(
      'system-prompt',
      'base instructions',
      (isObj(base) ? (str(base.text) ?? '') : '').length,
    );
  }

  private context(p: Json): void {
    this.model = str(p.model) ?? this.model;
    this.cwd(str(p.cwd));
  }

  private item(p: Json) {
    const type = str(p.type);
    if (type === 'message') return this.message(p);
    if (type === 'function_call') {
      const name = str(p.name) ?? 'unknown';
      const args = parseArgs(p.arguments);
      return this.call(str(p.call_id) ?? str(p.id), name, args, String(p.arguments ?? '').length);
    }
    if (type === 'custom_tool_call') {
      const input = str(p.input) ?? '';
      return this.call(
        str(p.call_id) ?? str(p.id),
        str(p.name) ?? 'unknown',
        { input },
        input.length,
      );
    }
    if (type === 'local_shell_call') {
      const action = isObj(p.action) ? p.action : {};
      return this.call(
        str(p.call_id) ?? str(p.id),
        'local_shell',
        action,
        JSON.stringify(action).length,
      );
    }
    if (type === 'web_search_call') {
      const action = isObj(p.action) ? p.action : {};
      return this.call(str(p.id), 'web_search', action, JSON.stringify(action).length);
    }
    if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      for (const c of this.callsFor(str(p.call_id) ?? '')) {
        c.outputSize = outputText(p.output).length;
        c.outputTokensEstimate = estimateTokens(c.outputSize);
        c.isError = c.isError || outputFailed(p.output);
      }
    }
  }

  private callsFor(id: string): ToolCall[] {
    const out: ToolCall[] = [];
    for (const [k, c] of this.calls) if (k === id || k.startsWith(`${id}#`)) out.push(c);
    return out;
  }

  private message(p: Json): void {
    if (str(p.role) !== 'user' && str(p.role) !== 'developer') return;
    for (const b of arr(p.content)) {
      const text = isObj(b) ? (str(b.text) ?? '') : '';
      if (/^\s*(?:<user_instructions>|# AGENTS\.md instructions)/.test(text))
        this.snap('instructions-file', 'AGENTS.md', text.length);
      else if (/^\s*<environment_context>/.test(text))
        this.snap('system-prompt', 'environment_context', text.length);
      else if (/^\s*<permissions instructions>/.test(text))
        this.snap('system-prompt', 'permissions', text.length);
      else if (/^\s*<skills_instructions>|^\s*## Skills/.test(text))
        this.snap('skill-listing', 'skills', text.length);
    }
  }

  private event(p: Json) {
    const type = str(p.type);
    if (type === 'token_count') return this.tokens(p);
    if (type === 'exec_command_end') {
      for (const c of this.callsFor(str(p.call_id) ?? ''))
        if (typeof p.exit_code === 'number' && p.exit_code !== 0) c.isError = true;
    }
  }

  // her yeni token_count = bir model isteği (aynı toplam tekrarlanırsa atlanır)
  private tokens(p: Json): void {
    const info = isObj(p.info) ? p.info : undefined;
    if (!info) return;
    const total = isObj(info.total_token_usage) ? info.total_token_usage : undefined;
    if (total && this.lastTotal && num(total.total_tokens) === num(this.lastTotal.total_tokens))
      return;
    const last = isObj(info.last_token_usage)
      ? info.last_token_usage
      : total
        ? diff(total, this.lastTotal ?? {})
        : undefined;
    if (total) this.lastTotal = total;
    if (!last) return;
    const turn: Turn = {
      index: this.turns.length,
      messageId: `${this.sessionId ?? basename(this.file)}#${this.turns.length}`,
      timestamp: new Date(this.ts || Date.now()),
      model: this.model,
      usage: readUsage(last),
      toolCalls: this.pending,
    };
    if (this.pendingCompact) {
      turn.compacted = true;
      this.pendingCompact = false;
    }
    this.turns.push(turn);
    this.pending = [];
  }

  private call(id: string | undefined, rawName: string, args: Json, inputSize: number) {
    const callId = id ?? `${this.turns.length}#${this.pending.length}`;
    if (this.calls.has(callId)) return;
    const server = codexMcpServer(rawName);
    const base: ToolCall = {
      id: callId,
      name: rawName,
      inputSize,
      outputSize: 0,
      outputTokensEstimate: 0,
      isError: false,
      isMcp: !!server,
      mcpServer: server,
    };
    const push = (c: ToolCall) => {
      this.pending.push(c);
      this.calls.set(c.id, c);
    };

    if (SHELL_TOOLS.has(rawName)) {
      const cmd = commandText(args.command ?? args.cmd);
      const file = readTarget(cmd);
      if (file) {
        const target = homeRel(file);
        const skill = /(?:^|\/)skills\/(?:\.system\/)?([^/]+)\/SKILL\.md$/.exec(file)?.[1];
        if (skill) this.skills.add(skill);
        return push({ ...base, name: 'Read', target, skillName: skill });
      }
      return push({
        ...base,
        name: 'Bash',
        target: summarizeCommand(cmd, this.redact),
        commands: summarizeCommands(cmd),
      });
    }
    if (rawName === 'apply_patch') {
      const patch = str(args.input) ?? str(args.patch) ?? '';
      const files = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) =>
        m[1]?.trim(),
      );
      if (!files.length) return push({ ...base, name: 'Edit' });
      files.forEach((f, i) => {
        push({
          ...base,
          id: i ? `${callId}#${i}` : callId,
          name: 'Edit',
          target: homeRel(f),
          inputSize: i ? 0 : inputSize,
        });
      });
      return;
    }
    if (rawName === 'read_file' || rawName === 'view_image') {
      const target = homeRel(str(args.file_path) ?? str(args.path));
      const range =
        args.offset !== undefined || args.limit !== undefined
          ? `${num(args.offset)}+${args.limit === undefined ? '' : num(args.limit)}`
          : undefined;
      return push({ ...base, name: 'Read', target, range });
    }
    if (rawName === 'grep_files' || rawName === 'list_dir') {
      return push({
        ...base,
        name: rawName === 'grep_files' ? 'Grep' : 'Glob',
        target: homeRel(str(args.path) ?? str(args.dir_path)),
      });
    }
    if (rawName === 'web_search') {
      return push({ ...base, name: 'WebSearch', target: urlHost(str(args.url)) });
    }
    push(base);
  }

  private snap(kind: SnapshotKind, name: string, chars: number): void {
    if (chars <= 0) return;
    const key = `${kind}|${name}`;
    const prev = this.snapshot.get(key);
    if (!prev || prev.chars < chars)
      this.snapshot.set(key, { kind, name, chars, estimatedTokens: estimateTokens(chars) });
  }

  build(): Session | null {
    if (this.pending.length && this.turns.length)
      this.turns.at(-1)?.toolCalls.push(...this.pending);
    if (this.turns.length === 0) return null;
    const fileId = basename(this.file, '.jsonl');
    const models = [...new Set(this.turns.map((t) => t.model).filter((m): m is string => !!m))];
    const first = this.turns[0]?.timestamp.getTime() ?? 0;
    const last = this.turns.at(-1)?.timestamp.getTime() ?? 0;
    return {
      id: this.sessionId ?? fileId,
      tool: 'codex',
      projectPath: this.cwds[0] ?? '(unknown)',
      cwds: this.cwds,
      startedAt: new Date(Number.isFinite(this.start) ? this.start : first),
      endedAt: new Date(Number.isFinite(this.end) ? this.end : last),
      models,
      version: this.version,
      isSidechain: this.isSidechain,
      parentSessionId: this.parent,
      turns: this.turns,
      contextSnapshot: [...this.snapshot.values()],
      skillsUsed: [...this.skills],
      compactions: this.compactions,
      source: { file: this.file },
    };
  }
}

export async function parseCodexFile(
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
