import type { RuleKind } from '../../model/types.js';

export interface RulePattern {
  kind: Exclude<RuleKind, 'unclassified'>;
  re: RegExp;
  // eşleşmeden parametre çıkarır; null → bu şablon geçersiz, sıradakine geç
  params: (m: RegExpMatchArray, line: string) => Record<string, string> | null;
}

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

export const PM_BUILTINS = new Set([
  'install',
  'i',
  'ci',
  'add',
  'remove',
  'rm',
  'uninstall',
  'exec',
  'dlx',
  'x',
  'init',
  'create',
  'publish',
  'update',
  'upgrade',
  'link',
  'why',
  'list',
  'ls',
  'outdated',
  'audit',
  'version',
  'login',
  'pack',
]);

export const pm = (expected: string) => ({
  expected: expected.toLowerCase(),
  forbidden: PACKAGE_MANAGERS.filter((p) => p !== expected.toLowerCase()).join(','),
});

export const looksLikePath = (s: string): boolean =>
  !/\s/.test(s) &&
  !/^[a-z]+:\/\//i.test(s) &&
  !/[*?{}<>$|]/.test(s) &&
  (s.includes('/') ||
    /^[\w.-]+\.(?:md|json|ya?ml|toml|ts|tsx|js|mjs|cjs|py|rs|go|swift|sh|env)$/i.test(s));

export const looksLikeCommand = (s: string): boolean =>
  /^[a-z][\w.-]*(?:\s+\S+)*$/i.test(s.trim()) && !looksLikePath(s.trim());

const SCRIPT_RE = /`((npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+))[^`]*`/i;

// dilden bağımsız: `pnpm run lint` / `yarn lint`
export const scriptPattern: RulePattern = {
  kind: 'script-reference',
  re: SCRIPT_RE,
  params: (m) => {
    const script = m[3] ?? '';
    const explicitRun = /\srun\s/i.test(m[1] ?? '');
    if (!explicitRun && (PM_BUILTINS.has(script) || (m[2] === 'npm' && script !== 'test'))) {
      return null;
    }
    return { script, manager: (m[2] ?? '').toLowerCase() };
  },
};

// dilden bağımsız: `src/api/` gibi backtick içi göreli/mutlak yol veya markdown linki
export const pathPattern: RulePattern = {
  kind: 'path-reference',
  re: /`([^`]+)`|\]\(([^)\s#]+)\)/g,
  params: (_m, line) => {
    for (const mm of line.matchAll(/`([^`]+)`|\]\(([^)\s#]+)\)/g)) {
      const p = (mm[1] ?? mm[2] ?? '').trim();
      if (looksLikePath(p)) return { path: p };
    }
    return null;
  },
};
