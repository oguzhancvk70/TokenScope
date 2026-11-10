import { normalizeServer } from '../discovery/usage.js';
import type { ContextItem, Finding, Session } from '../model/types.js';
import { daysAgo } from '../util/time.js';
import type { Analyzer } from './types.js';
import { fmtTokens, mainSessions, projectName, severityFor } from './util.js';

function loadedIn(item: ContextItem, sessions: Session[]): number {
  if (item.kind === 'mcp-server' && item.estimateSource === 'log') {
    const key = normalizeServer(item.name);
    return sessions.filter((s) =>
      s.contextSnapshot.some((c) => c.kind.startsWith('mcp-') && normalizeServer(c.name) === key),
    ).length;
  }
  return item.scope === 'global'
    ? sessions.length
    : sessions.filter((s) => s.projectPath === item.projectPath).length;
}

const where = (i: ContextItem) => (i.scope === 'global' ? 'global' : projectName(i.projectPath));

export const deadWeight: Analyzer = {
  id: 'dead-weight',
  description: 'Kurulu olup kullanılmayan skill / MCP / plugin',
  run(ctx) {
    const days = ctx.thresholds.deadWeightDays;
    const cutoff = daysAgo(ctx.now, days);
    const sessions = mainSessions(ctx.sessions).filter((s) => s.endedAt >= cutoff);
    if (!sessions.length) return [];
    const findings: Finding[] = [];

    for (const tool of ctx.inventory.tools) {
      const own = sessions.filter((s) => s.tool === tool.id);
      if (!own.length) continue;
      const unused = (i: ContextItem) => !(i.lastUsedAt && i.lastUsedAt >= cutoff);
      const deadPlugins = new Set(
        tool.contextItems.filter((i) => i.kind === 'plugin' && unused(i)).map((i) => i.name),
      );

      for (const p of tool.contextItems.filter(
        (i) => i.kind === 'plugin' && deadPlugins.has(i.name),
      )) {
        const parts = tool.contextItems.filter(
          (i) => i === p || (i.plugin === p.name && i.kind !== 'plugin'),
        );
        const perSession = parts.reduce((n, i) => n + i.estimatedTokens, 0);
        const loaded = loadedIn(p, own);
        findings.push({
          ruleId: 'dead-weight',
          severity: severityFor(perSession * loaded),
          title: `\`${p.name}\` plugin'i ${days} gündür kullanılmadı, her oturuma ~${fmtTokens(perSession)} token ekliyor`,
          detail: `${parts.length - 1} alt kalem (skill/MCP/agent) ile birlikte ${loaded} oturumda yüklendi.`,
          wastedTokens: perSession * loaded,
          wastedTokensExact: false,
          scope: { tool: tool.id },
          evidence: parts
            .filter((i) => i !== p)
            .map((i) => `${i.kind}: ${i.name}`)
            .slice(0, 10),
          suggestion:
            tool.id === 'gemini-cli'
              ? `gemini extensions disable ${p.name} (veya sadece gereken projede etkinleştir).`
              : `settings.json → enabledPlugins içinde "${p.name}" kapat veya sadece gereken projede etkinleştir.`,
        });
      }

      for (const m of tool.contextItems.filter(
        (i) => i.kind === 'mcp-server' && unused(i) && !(i.plugin && deadPlugins.has(i.plugin)),
      )) {
        const loaded = loadedIn(m, own);
        const known = m.estimateSource !== 'none';
        findings.push({
          ruleId: 'dead-weight',
          severity: known ? severityFor(m.estimatedTokens * loaded) : 'low',
          title: known
            ? `\`${m.name}\` MCP'si ${days} gündür çağrılmadı, her oturuma ~${fmtTokens(m.estimatedTokens)} token ekliyor`
            : `\`${m.name}\` MCP'si ${days} gündür çağrılmadı (boyut verisi yok)`,
          detail: `Kapsam: ${where(m)}; ${loaded} oturumda yüklü. Kaynak: ${m.path}`,
          wastedTokens: known ? m.estimatedTokens * loaded : 0,
          wastedTokensExact: false,
          scope: { tool: tool.id, projectPath: m.projectPath },
          evidence: [m.name],
          suggestion:
            tool.id === 'codex'
              ? `config.toml içinde [mcp_servers.${m.name}] için enabled = false yap veya projenin .codex/config.toml dosyasına taşı.`
              : tool.id === 'gemini-cli'
                ? `settings.json → mcpServers içinden "${m.name}" kaldır veya projenin .gemini/settings.json dosyasına taşı.`
                : 'Sunucuyu kapat veya global yerine sadece gereken projenin .mcp.json dosyasına taşı.',
        });
      }

      const skills = tool.contextItems.filter(
        (i) => i.kind === 'skill' && unused(i) && !(i.plugin && deadPlugins.has(i.plugin)),
      );
      if (skills.length) {
        const wasted = skills.reduce((n, s) => n + s.estimatedTokens * loadedIn(s, own), 0);
        const perSession = skills
          .filter((s) => s.scope === 'global')
          .reduce((n, s) => n + s.estimatedTokens, 0);
        findings.push({
          ruleId: 'dead-weight',
          severity: severityFor(wasted),
          title: `${skills.length} skill ${days} gündür kullanılmadı (global olanlar ~${fmtTokens(perSession)} token/oturum)`,
          detail: 'Skill açıklamaları her oturumdaki skill listesine giriyor.',
          wastedTokens: wasted,
          wastedTokensExact: false,
          scope: { tool: tool.id },
          evidence: skills
            .sort((a, b) => b.estimatedTokens - a.estimatedTokens)
            .slice(0, 10)
            .map((s) => `${s.name} (~${fmtTokens(s.estimatedTokens)}, ${where(s)})`),
          suggestion: "Kullanmadığın skill'leri kaldır ya da proje bazına (.claude/skills) taşı.",
        });
      }
    }
    return findings;
  },
};
