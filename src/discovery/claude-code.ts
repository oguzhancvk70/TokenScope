import { readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import fg from 'fast-glob';
import type { ContextItem, ContextItemKind } from '../model/types.js';
import { estimateTokens } from '../tokens/estimate.js';
import { parseFrontmatter } from '../util/frontmatter.js';
import { arr, exists, isDir, isObj, readJson, readText, str } from '../util/fs.js';

export const claudeDir = (home: string): string => join(home, '.claude');
export const claudeJson = (home: string): string => join(home, '.claude.json');
export const projectSlug = (projectPath: string): string =>
  projectPath.replace(/[^a-zA-Z0-9]/g, '-');

export const SCAN_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/Pods/**',
  '**/.build/**',
  '**/DerivedData/**',
  '**/target/**',
  '**/.next/**',
  '**/vendor/**',
];

export async function fileItem(
  kind: ContextItemKind,
  path: string,
  scope: 'global' | 'project',
  extra: Partial<ContextItem> = {},
): Promise<ContextItem | null> {
  const text = await readText(path);
  if (text === undefined) return null;
  return {
    kind,
    name: extra.name ?? basename(path),
    path,
    scope,
    estimatedTokens: estimateTokens(text.length),
    estimateSource: 'file',
    ...extra,
  };
}

// skill listesine giren kısım: ad + açıklama
export async function skillItem(
  skillMd: string,
  scope: 'global' | 'project',
  extra: Partial<ContextItem> = {},
): Promise<ContextItem | null> {
  const text = await readText(skillMd);
  if (text === undefined) return null;
  const fm = parseFrontmatter(text);
  const base = fm.name || basename(dirname(skillMd));
  const name = extra.plugin ? `${extra.plugin}:${base}` : base;
  return {
    kind: 'skill',
    name,
    path: skillMd,
    scope,
    estimatedTokens: estimateTokens(name.length + (fm.description ?? '').length + 8),
    estimateSource: 'file',
    ...extra,
  };
}

export function mcpItems(
  servers: unknown,
  path: string,
  scope: 'global' | 'project',
  extra: Partial<ContextItem> = {},
  skip: string[] = [],
): ContextItem[] {
  if (!isObj(servers)) return [];
  return Object.keys(servers)
    .filter((n) => !skip.includes(n))
    .map((n) => ({
      kind: 'mcp-server' as const,
      name: extra.plugin ? `plugin:${extra.plugin}:${n}` : n,
      path,
      scope,
      estimatedTokens: 0,
      estimateSource: 'none' as const,
      ...extra,
    }));
}

async function resolvePluginPath(
  home: string,
  key: string,
  entry: unknown,
): Promise<string | undefined> {
  const first = Array.isArray(entry) ? entry[0] : entry;
  const installPath = isObj(first) ? str(first.installPath) : undefined;
  if (installPath && (await isDir(installPath))) return installPath;
  const [name, market] = key.split('@');
  if (!name || !market) return undefined;
  const base = join(claudeDir(home), 'plugins', 'cache', market, name);
  try {
    const versions = (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory());
    return versions.length
      ? join(base, versions.sort((a, b) => a.name.localeCompare(b.name)).at(-1)!.name)
      : undefined;
  } catch {
    return undefined;
  }
}

async function pluginItems(home: string, settings: unknown): Promise<ContextItem[]> {
  const enabled = isObj(settings) && isObj(settings.enabledPlugins) ? settings.enabledPlugins : {};
  const installed = await readJson(join(claudeDir(home), 'plugins', 'installed_plugins.json'));
  const registry = isObj(installed) && isObj(installed.plugins) ? installed.plugins : {};
  const items: ContextItem[] = [];
  for (const [key, on] of Object.entries(enabled)) {
    if (on !== true) continue;
    const plugin = key.split('@')[0] ?? key;
    const root = await resolvePluginPath(home, key, registry[key]);
    if (!root) {
      items.push({
        kind: 'plugin',
        name: plugin,
        path: key,
        scope: 'global',
        estimatedTokens: 0,
        estimateSource: 'none',
      });
      continue;
    }
    // agent + komut açıklamaları plugin'in kendi yükü; skill'ler ayrı kalem
    let chars = 0;
    for (const md of await fg(['agents/*.md', 'commands/*.md'], { cwd: root, absolute: true })) {
      const fm = parseFrontmatter((await readText(md)) ?? '');
      chars += (fm.name ?? basename(md)).length + (fm.description ?? '').length + 8;
    }
    items.push({
      kind: 'plugin',
      name: plugin,
      path: root,
      scope: 'global',
      estimatedTokens: estimateTokens(chars),
      estimateSource: 'file',
    });
    for (const md of await fg('skills/*/SKILL.md', { cwd: root, absolute: true })) {
      const it = await skillItem(md, 'global', { plugin });
      if (it) items.push(it);
    }
    const mcpJson = await readJson(join(root, '.mcp.json'));
    const manifest = await readJson(join(root, '.claude-plugin', 'plugin.json'));
    const servers = {
      ...(isObj(mcpJson) && isObj(mcpJson.mcpServers) ? mcpJson.mcpServers : {}),
      ...(isObj(manifest) && isObj(manifest.mcpServers) ? manifest.mcpServers : {}),
    };
    items.push(...mcpItems(servers, root, 'global', { plugin }));
  }
  return items;
}

function hookItems(settings: unknown, path: string): ContextItem[] {
  const hooks = isObj(settings) && isObj(settings.hooks) ? settings.hooks : {};
  return Object.entries(hooks).map(([event, matchers]) => ({
    kind: 'hook' as const,
    name: `${event} (${arr(matchers).reduce<number>((n, m) => n + (isObj(m) ? arr(m.hooks).length : 0), 0)})`,
    path,
    scope: 'global' as const,
    estimatedTokens: 0,
    estimateSource: 'none' as const,
  }));
}

async function projectItems(home: string, project: string, cfg: unknown): Promise<ContextItem[]> {
  const items: ContextItem[] = [];
  const add = (it: ContextItem | null) => it && items.push(it);
  const memory = join(claudeDir(home), 'projects', projectSlug(project), 'memory', 'MEMORY.md');
  add(
    await fileItem('memory-file', memory, 'project', {
      projectPath: project,
      name: `MEMORY.md (${basename(project)})`,
    }),
  );

  const projCfg =
    isObj(cfg) && isObj(cfg.projects) && isObj(cfg.projects[project]) ? cfg.projects[project] : {};
  items.push(
    ...mcpItems(projCfg.mcpServers, claudeJson(home), 'project', { projectPath: project }),
  );

  if (!(await isDir(project))) return items;
  const rootFiles = ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md', 'AGENTS.md'];
  for (const f of rootFiles) {
    add(
      await fileItem('instructions-file', join(project, f), 'project', {
        projectPath: project,
        name: `${basename(project)}/${f}`,
      }),
    );
  }
  // ev dizininde açılan oturumda tüm ev dizini taranmaz
  const nested =
    project === home
      ? []
      : await fg('**/CLAUDE.md', {
          cwd: project,
          ignore: SCAN_IGNORE,
          deep: 4,
          absolute: true,
          suppressErrors: true,
        });
  for (const p of nested) {
    const rel = relative(project, p);
    if (rootFiles.includes(rel)) continue;
    add(
      await fileItem('instructions-file', p, 'project', {
        projectPath: project,
        name: `${basename(project)}/${rel}`,
        onDemand: true,
      }),
    );
  }
  for (const md of await fg('.claude/skills/*/SKILL.md', {
    cwd: project,
    absolute: true,
    dot: true,
    suppressErrors: true,
  })) {
    add(await skillItem(md, 'project', { projectPath: project }));
  }
  const mcpJson = await readJson(join(project, '.mcp.json'));
  if (isObj(mcpJson)) {
    const disabled = arr(projCfg.disabledMcpjsonServers).filter(
      (s): s is string => typeof s === 'string',
    );
    items.push(
      ...mcpItems(
        mcpJson.mcpServers,
        join(project, '.mcp.json'),
        'project',
        { projectPath: project },
        disabled,
      ),
    );
  }
  return items;
}

export async function discoverClaudeContext(
  home: string,
  projectPaths: string[],
): Promise<ContextItem[]> {
  const dir = claudeDir(home);
  const settingsPath = join(dir, 'settings.json');
  const [settings, cfg] = await Promise.all([readJson(settingsPath), readJson(claudeJson(home))]);
  const items: ContextItem[] = [];
  const add = (it: ContextItem | null) => it && items.push(it);

  add(
    await fileItem('instructions-file', join(dir, 'CLAUDE.md'), 'global', {
      name: '~/.claude/CLAUDE.md',
    }),
  );
  if (await isDir(join(dir, 'skills'))) {
    const skills = await fg('**/SKILL.md', {
      cwd: join(dir, 'skills'),
      absolute: true,
      deep: 5,
      ignore: ['**/.staging/**'],
    });
    for (const md of skills) add(await skillItem(md, 'global'));
  }
  if (isObj(cfg)) items.push(...mcpItems(cfg.mcpServers, claudeJson(home), 'global'));
  items.push(...(await pluginItems(home, settings)));
  items.push(...hookItems(settings, settingsPath));
  for (const p of projectPaths) items.push(...(await projectItems(home, p, cfg)));
  // aynı dosya hem global hem proje kalemi olmasın (ör. ev dizininde açılan oturum)
  const seen = new Set<string>();
  return items.filter((i) => {
    if (i.path === claudeJson(home) || i.estimateSource === 'none') return true;
    const key = `${i.kind}|${i.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface UsageCounter {
  usageCount: number;
  lastUsedAt?: Date;
}

export async function readUsageCounters(
  home: string,
): Promise<{ skills: Map<string, UsageCounter>; plugins: Map<string, UsageCounter> }> {
  const cfg = await readJson(claudeJson(home));
  const read = (v: unknown) => {
    const m = new Map<string, UsageCounter>();
    if (!isObj(v)) return m;
    for (const [k, e] of Object.entries(v)) {
      if (!isObj(e)) continue;
      const ts = typeof e.lastUsedAt === 'number' ? new Date(e.lastUsedAt) : undefined;
      m.set(k, { usageCount: typeof e.usageCount === 'number' ? e.usageCount : 0, lastUsedAt: ts });
    }
    return m;
  };
  return {
    skills: read(isObj(cfg) ? cfg.skillUsage : undefined),
    plugins: read(isObj(cfg) ? cfg.pluginUsage : undefined),
  };
}

export async function claudeInstalled(home: string): Promise<boolean> {
  return (await exists(claudeDir(home))) || (await exists(claudeJson(home)));
}
