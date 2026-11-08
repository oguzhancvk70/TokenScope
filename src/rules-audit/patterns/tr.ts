import {
  looksLikeCommand,
  looksLikePath,
  PACKAGE_MANAGERS,
  pm,
  type RulePattern,
} from './types.js';

const PM = `(${PACKAGE_MANAGERS.join('|')})`;
const SUFFIX = `(?:['’]\\p{L}*)?`;
const trigger = (s: string) => (s.toLowerCase() === 'push' ? 'push' : 'commit');
const cmd = (c: string | undefined) => (c && looksLikeCommand(c) ? c.trim() : null);

export const TR_PATTERNS: RulePattern[] = [
  {
    kind: 'required-command',
    re: /`([^`]+)`\s*(?:komutunu\s+)?(?:çalıştırmadan|koşmadan)\s+(commit|push)/iu,
    params: (m) => (cmd(m[1]) ? { command: cmd(m[1])!, before: trigger(m[2]!) } : null),
  },
  {
    kind: 'required-command',
    re: /(commit|push)(?:['’]\p{L}*)?\s+(?:öncesi|önce|öncesinde)\s[^`]*`([^`]+)`/iu,
    params: (m) => (cmd(m[2]) ? { command: cmd(m[2])!, before: trigger(m[1]!) } : null),
  },
  {
    kind: 'required-command',
    re: /`([^`]+)`[^`]*\s(commit|push)(?:['’]\p{L}*)?\s+(?:öncesi|önce|öncesinde)(?!\p{L})/iu,
    params: (m) => (cmd(m[1]) ? { command: cmd(m[1])!, before: trigger(m[2]!) } : null),
  },
  {
    kind: 'package-manager',
    re: new RegExp(`\`?${PM}\`?${SUFFIX}\\s+(?:asla\\s+)?kullanma(?!\\p{L})`, 'iu'),
    params: (m) => ({ expected: '', forbidden: m[1]!.toLowerCase() }),
  },
  {
    kind: 'package-manager',
    re: new RegExp(`paket\\s+yöneticisi\\s*:?\\s*\`?${PM}(?![\\w-])`, 'iu'),
    params: (m) => pm(m[1]!),
  },
  {
    kind: 'package-manager',
    re: new RegExp(
      `(?<![\\w-])\`?${PM}\`?${SUFFIX}\\s+(?:kullan|kullanılır|kullanılacak|kullanıyoruz|kullanın|ile çalış)(?!\\p{L})`,
      'iu',
    ),
    params: (m) => pm(m[1]!),
  },
  {
    kind: 'forbidden-path',
    re: /`([^`]+)`\s*(?:klasör\p{L}*|dizin\p{L}*|dosya\p{L}*|altı\p{L}*)?\s*(?:asla\s+)?(?:dokunma|değiştirme|düzenleme|elleme|yazma)(?!\p{L})/iu,
    params: (m) => (looksLikePath(m[1]!) ? { path: m[1]! } : null),
  },
  {
    kind: 'forbidden-command',
    re: /`([^`]+)`\s*(?:komut\p{L}*\s+)?(?:asla\s+)?(?:çalıştırma|yapma|kullanma|koşma)(?!\p{L})/iu,
    params: (m) => (cmd(m[1]) ? { command: cmd(m[1])! } : null),
  },
  {
    kind: 'forbidden-command',
    re: /(?:asla|kesinlikle)\s+`([^`]+)`|`([^`]+)`\s*(?:yasak|yasaktır)(?!\p{L})/iu,
    params: (m) => (cmd(m[1] ?? m[2]) ? { command: cmd(m[1] ?? m[2])! } : null),
  },
];
