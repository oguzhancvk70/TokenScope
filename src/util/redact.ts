import { homedir } from 'node:os';
import { basename } from 'node:path';

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}/g,
];

const KEYED_SECRETS: RegExp[] = [
  /(\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Za-z0-9_]*=)\S+/gi,
  /(--?(?:password|passwd|token|api-key|apikey|secret|auth)[= ])\S+/gi,
  /(\b(?:Bearer|Basic) )\S+/g,
  /(:\/\/[^/\s:@]+:)[^@\s]+(?=@)/g,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const re of KEYED_SECRETS) out = out.replace(re, '$1***');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***');
  return out;
}

let home = homedir();
export const setHomeForRedaction = (h: string): void => {
  home = h;
};

export function homeRel(path: string | undefined): string | undefined {
  if (!path) return path;
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const SETUP_CMD = /^(?:cd|export|source|set|unset|pushd|popd|\.)\b/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// komutu "araç + alt komut" düzeyine indirir; argümanlar (olası secret/içerik) atılır
export function summarizeCommand(command: string, redact = true): string {
  if (!redact) return maskSecrets(command.replace(/\s+/g, ' ').trim()).slice(0, 200);
  const segments = command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const main = segments.find((s) => !SETUP_CMD.test(s)) ?? segments[0] ?? '';
  const words = main.split(/\s+/).filter((w) => w && !ENV_ASSIGN.test(w));
  const head: string[] = [];
  for (const w of words) {
    if (head.length === 2) break;
    if (head.length === 1 && (w.startsWith('-') || /["'`$<>]/.test(w))) break;
    head.push(w.includes('/') ? basename(w) : w);
  }
  return maskSecrets(head.join(' '));
}

// zincirdeki her komutun özeti (kural denetimi için; argümanlar yine atılır)
export function summarizeCommands(command: string): string[] {
  return command
    .split(/&&|\|\||;|\||\n/)
    .map((s) => s.trim())
    .filter((s) => s && !SETUP_CMD.test(s))
    .map((s) => summarizeCommand(s, true))
    .filter(Boolean);
}

export function urlHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
