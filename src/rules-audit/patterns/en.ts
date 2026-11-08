import {
  looksLikeCommand,
  looksLikePath,
  PACKAGE_MANAGERS,
  pm,
  type RulePattern,
} from './types.js';

const PM = `(${PACKAGE_MANAGERS.join('|')})`;
const trigger = (s: string) => (s.toLowerCase().startsWith('push') ? 'push' : 'commit');
const cmd = (c: string | undefined) => (c && looksLikeCommand(c) ? c.trim() : null);

export const EN_PATTERNS: RulePattern[] = [
  {
    kind: 'required-command',
    re: /\b(?:never|don't|do not)\s+(commit|push)\s+without\s+(?:running\s+)?`([^`]+)`/i,
    params: (m) => (cmd(m[2]) ? { command: cmd(m[2])!, before: trigger(m[1]!) } : null),
  },
  {
    kind: 'required-command',
    re: /\b(?:before|prior to)\s+(?:each\s+|every\s+|any\s+|a\s+)?(commit(?:ting)?|push(?:ing)?)\b[^`]*`([^`]+)`/i,
    params: (m) => (cmd(m[2]) ? { command: cmd(m[2])!, before: trigger(m[1]!) } : null),
  },
  {
    kind: 'required-command',
    re: /`([^`]+)`[^`]*\bbefore\s+(?:each\s+|every\s+|any\s+|a\s+)?(commit(?:ting)?|push(?:ing)?)\b/i,
    params: (m) => (cmd(m[1]) ? { command: cmd(m[1])!, before: trigger(m[2]!) } : null),
  },
  {
    kind: 'package-manager',
    re: new RegExp(
      `\\b(?:never|do not|don't|avoid)\\s+(?:use\\s+)?\`?${PM}\`?(?![\\w\`-]|\\s+[a-z])`,
      'i',
    ),
    params: (m) => ({ expected: '', forbidden: m[1]!.toLowerCase() }),
  },
  {
    kind: 'package-manager',
    re: new RegExp(
      `\\b(?:always\\s+)?(?:use|prefer|we use|stick to|package manager(?:\\s+is)?:?)\\s+\`?${PM}\`?(?![\\w-]|\\s+(?:run|install|i|test|add|exec|x|dlx)\\b)`,
      'i',
    ),
    params: (m) => pm(m[1]!),
  },
  {
    kind: 'package-manager',
    re: new RegExp(`\\b${PM}\\s+only\\b`, 'i'),
    params: (m) => pm(m[1]!),
  },
  {
    kind: 'forbidden-path',
    re: /\b(?:never|do not|don't|must not|avoid)\s+(?:touch(?:ing)?|edit(?:ing)?|modify(?:ing)?|chang(?:e|ing)|writ(?:e|ing)(?:\s+to)?)\s+(?:anything\s+(?:in|under)\s+|files\s+(?:in|under)\s+|the\s+)?`([^`]+)`/i,
    params: (m) => (looksLikePath(m[1]!) ? { path: m[1]! } : null),
  },
  {
    kind: 'forbidden-command',
    re: /\b(?:never|do not|don't|must not|avoid)\s+(?:run(?:ning)?\s+|use\s+|using\s+|execute\s+|call\s+)?`([^`]+)`/i,
    params: (m) => (cmd(m[1]) ? { command: cmd(m[1])! } : null),
  },
];
