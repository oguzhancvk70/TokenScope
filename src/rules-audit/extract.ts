import { createHash } from 'node:crypto';
import type { InstructionRule, Inventory } from '../model/types.js';
import { estimateTextTokens } from '../tokens/estimate.js';
import { readText } from '../util/fs.js';
import { EN_PATTERNS } from './patterns/en.js';
import { TR_PATTERNS } from './patterns/tr.js';
import { pathPattern, type RulePattern, scriptPattern } from './patterns/types.js';

// sıra önemli: ilk eşleşen şablon kazanır
export const PATTERNS: RulePattern[] = [...TR_PATTERNS, ...EN_PATTERNS, scriptPattern, pathPattern];

export interface RuleSource {
  path: string;
  scope: 'global' | 'project';
  projectPath?: string;
}

const ruleId = (path: string, line: number, text: string) =>
  createHash('sha1').update(`${path}:${line}:${text}`).digest('hex').slice(0, 10);

// madde/paragraf satırını sade metne indirir; kural olmayan satırlar null
function ruleText(raw: string): string | null {
  const t = raw.trim();
  if (!t || /^#{1,6}\s/.test(t) || /^<!--.*-->$/.test(t) || /^[-*_=|:\s]{3,}$/.test(t)) return null;
  const text = t
    .replace(/^>\s*/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\|(.*)\|$/, '$1')
    .trim();
  return text.length >= 3 ? text : null;
}

export function extractRules(text: string, source: RuleSource): InstructionRule[] {
  const rules: InstructionRule[] = [];
  let fence = false;
  let frontmatter = false;
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    if (i === 0 && raw.trim() === '---') {
      frontmatter = true;
      continue;
    }
    if (frontmatter) {
      if (raw.trim() === '---') frontmatter = false;
      continue;
    }
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = ruleText(raw);
    if (!t) continue;
    let kind: InstructionRule['kind'] = 'unclassified';
    let params: Record<string, string> = {};
    for (const p of PATTERNS) {
      const m = t.match(new RegExp(p.re.source, p.re.flags.replace('g', '')));
      if (!m) continue;
      const got = p.params(m, t);
      if (!got) continue;
      kind = p.kind;
      params = got;
      break;
    }
    rules.push({
      id: ruleId(source.path, i + 1, t),
      kind,
      text: t,
      source: { ...source, line: i + 1 },
      params,
      estimatedTokens: estimateTextTokens(raw),
    });
  }
  return rules;
}

// envanterdeki talimat dosyalarından kurallar (aynı dosya bir kez)
export async function loadRules(inventory: Inventory): Promise<InstructionRule[]> {
  const seen = new Set<string>();
  const rules: InstructionRule[] = [];
  for (const tool of inventory.tools) {
    for (const item of tool.contextItems) {
      if (item.kind !== 'instructions-file' || seen.has(item.path)) continue;
      seen.add(item.path);
      const text = await readText(item.path);
      if (text === undefined) continue;
      rules.push(
        ...extractRules(text, {
          path: item.path,
          scope: item.scope,
          projectPath: item.projectPath,
        }),
      );
    }
  }
  return rules;
}
