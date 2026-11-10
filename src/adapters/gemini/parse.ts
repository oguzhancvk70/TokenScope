import { createReadStream } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { Session, TokenUsage, ToolCall, Turn } from '../../model/types.js';
import { estimateTokens } from '../../tokens/estimate.js';
import { arr, isObj, type Json, num, readText, str } from '../../util/fs.js';
import { homeRel, summarizeCommand, summarizeCommands, urlHost } from '../../util/redact.js';
import type { ParseStats } from '../types.js';

const MESSAGE_TYPES = new Set(['user', 'gemini', 'info', 'error', 'warning']);
const RENAME: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Write',
  replace: 'Edit',
  run_shell_command: 'Bash',
  glob: 'Glob',
  list_directory: 'Glob',
  grep_search: 'Grep',
  search_file_content: 'Grep',
  web_fetch: 'WebFetch',
  google_web_search: 'WebSearch',
  activate_skill: 'Skill',
};

// Gemini MCP adı: mcp_<server>_<tool> (eski: <server>__<tool>); bilinen sunucu adı önceliklidir
export function geminiMcpServer(name: string, known: string[] = []): string | undefined {
  if (name.includes('__')) return name.split('__')[0];
  if (!name.startsWith('mcp_')) return undefined;
  const rest = name.slice(4);
  const hit = [...known]
    .sort((a, b) => b.length - a.length)
    .find((k) => rest.startsWith(`${k}_`) || rest.startsWith(`${k.replace(/[^\w]/g, '_')}_`));
  return hit ?? rest.split('_')[0];
}

function readUsage(t: unknown): TokenUsage {
  const o = isObj(t) ? t : {};
  const cached = num(o.cached);
  return {
    input: Math.max(0, num(o.input) - cached) + num(o.tool),
    output: num(o.output) + num(o.thoughts),
    cacheRead: cached,
    cacheWrite: 0,
    exact: isObj(t),
  };
}

function resultChars(r: unknown): number {
  let n = 0;
  for (const part of arr(r)) {
    const fr = isObj(part) && isObj(part.functionResponse) ? part.functionResponse : undefined;
    const resp = fr && isObj(fr.response) ? fr.response : undefined;
    if (resp) {
      const out = resp.output ?? resp.error ?? resp;
      n += typeof out === 'string' ? out.length : JSON.stringify(out).length;
    } else if (isObj(part) && typeof part.text === 'string') n += part.text.length;
    else n += JSON.stringify(part).length;
  }
  return n;
}

export interface GeminiParseOptions {
  redact: boolean;
  projectPath?: string;
  mcpServers?: string[];
}

export function buildSession(
  file: string,
  meta: Json,
  messages: Json[],
  opts: GeminiParseOptions,
): Session | null {
  const turns: Turn[] = [];
  const skills = new Set<string>();
  let start = Date.parse(str(meta.startTime) ?? '');
  let end = Date.parse(str(meta.lastUpdated) ?? '');
  const sessionId = str(meta.sessionId) ?? basename(file).replace(/\.jsonl?$/, '');

  for (const m of messages) {
    const ts = Date.parse(str(m.timestamp) ?? '');
    if (!Number.isNaN(ts)) {
      start = Number.isNaN(start) ? ts : Math.min(start, ts);
      end = Number.isNaN(end) ? ts : Math.max(end, ts);
    }
    if (m.type !== 'gemini') continue;
    const calls = arr(m.toolCalls).filter(isObj);
    if (!isObj(m.tokens) && !calls.length) continue;
    turns.push({
      index: turns.length,
      messageId: str(m.id) ?? `${sessionId}#${turns.length}`,
      timestamp: new Date(Number.isNaN(ts) ? 0 : ts),
      model: str(m.model),
      usage: readUsage(m.tokens),
      toolCalls: calls.map((c, i) => toolCall(c, `${str(m.id)}#${i}`, opts, skills)),
    });
  }
  if (!turns.length) return null;

  const dirs = arr(meta.directories).filter((d): d is string => typeof d === 'string');
  const projectPath = opts.projectPath ?? dirs[0] ?? '(unknown)';
  const isSidechain = meta.kind === 'subagent';
  const parentDir = basename(dirname(file));
  return {
    id: isSidechain ? `${parentDir}/${sessionId}` : sessionId,
    tool: 'gemini-cli',
    projectPath,
    cwds: [...new Set([projectPath, ...dirs])],
    startedAt: new Date(Number.isNaN(start) ? turns[0]!.timestamp.getTime() : start),
    endedAt: new Date(Number.isNaN(end) ? turns.at(-1)!.timestamp.getTime() : end),
    models: [...new Set(turns.map((t) => t.model).filter((x): x is string => !!x))],
    isSidechain,
    parentSessionId: isSidechain ? parentDir : undefined,
    turns,
    contextSnapshot: [],
    skillsUsed: [...skills],
    compactions: 0,
    source: { file },
  };
}

function toolCall(
  c: Json,
  fallbackId: string,
  opts: GeminiParseOptions,
  skills: Set<string>,
): ToolCall {
  const raw = str(c.name) ?? 'unknown';
  const args = isObj(c.args) ? c.args : {};
  const server = RENAME[raw] ? undefined : geminiMcpServer(raw, opts.mcpServers);
  const outputSize = resultChars(c.result);
  const call: ToolCall = {
    id: str(c.id) ?? fallbackId,
    name: RENAME[raw] ?? raw,
    inputSize: JSON.stringify(args).length,
    outputSize,
    outputTokensEstimate: estimateTokens(outputSize),
    isError: c.status === 'error',
    isMcp: !!server,
    mcpServer: server,
  };
  const path =
    str(args.file_path) ?? str(args.absolute_path) ?? str(args.dir_path) ?? str(args.path);
  if (call.name === 'Read') {
    call.target = homeRel(path);
    if (args.start_line !== undefined || args.end_line !== undefined || args.offset !== undefined)
      call.range = `${num(args.start_line ?? args.offset)}+${args.end_line === undefined ? (args.limit === undefined ? '' : num(args.limit)) : num(args.end_line)}`;
  } else if (call.name === 'Bash') {
    const cmd = str(args.command) ?? '';
    call.target = summarizeCommand(cmd, opts.redact);
    call.commands = summarizeCommands(cmd);
  } else if (call.name === 'Skill') {
    call.skillName = str(args.name) ?? str(args.skill);
    call.target = call.skillName;
    if (call.skillName) skills.add(call.skillName);
  } else if (call.name === 'WebFetch') {
    call.target = urlHost(/https?:\/\/\S+/.exec(str(args.prompt) ?? str(args.url) ?? '')?.[0]);
  } else if (call.name === 'Grep' || call.name === 'Glob') {
    call.target = homeRel(path) ?? (opts.redact ? undefined : str(args.pattern));
  } else if (path) call.target = homeRel(path);
  return call;
}

// .jsonl: ilk satır metadata, sonra mesajlar (aynı id = güncelleme), {$set}, {$rewindTo}
// .json (eski): tek nesne { ...metadata, messages: [] }
export async function parseGeminiFile(
  file: string,
  opts: GeminiParseOptions,
  stats: ParseStats,
): Promise<Session | null> {
  const meta: Json = {};
  const messages = new Map<string, Json>();
  const push = (m: Json) => {
    const id = str(m.id) ?? `#${messages.size}`;
    messages.set(id, m);
  };

  if (file.endsWith('.json')) {
    const text = await readText(file);
    stats.files++;
    stats.lines++;
    let o: unknown;
    try {
      o = JSON.parse(text ?? '');
    } catch {
      stats.skippedLines++;
      return null;
    }
    if (!isObj(o)) return null;
    const { messages: list, ...rest } = o;
    Object.assign(meta, rest);
    for (const m of arr(list)) if (isObj(m)) push(m);
    return buildSession(file, meta, [...messages.values()], opts);
  }

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
    if (isObj(o.$set)) Object.assign(meta, o.$set);
    else if ('$rewindTo' in o)
      continue; // geri sarılan mesajlar da faturalandı; tutulur
    else if (str(o.type) && MESSAGE_TYPES.has(str(o.type)!)) push(o);
    else if (str(o.sessionId) && !o.type) Object.assign(meta, o);
    else stats.unknownTypes++;
  }
  stats.files++;
  return buildSession(file, meta, [...messages.values()], opts);
}
