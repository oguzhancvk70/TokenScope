import type { Finding, ModelAdvice, ModelOption, Session } from '../model/types.js';
import {
  costWithRates,
  MODELS,
  modelKey,
  providerOf,
  ratesFor,
  recommendable,
  usageCost,
} from '../pricing.js';
import type { Analyzer } from './types.js';
import { fmtTokens, fmtUSD, projectName } from './util.js';

// karmaşıklık sezgisi eşikleri (gerçek Claude Code loglarıyla kalibre: cache'li oturumlar zaten 100k+ bağlamla çalışır)
const BIG_CONTEXT = 180_000;
const HUGE_CONTEXT = 400_000;
const MANY_FILES = 60;
const VERY_MANY_FILES = 150;
const LONG_SESSION_TURNS = 120;
const HIGH_ERROR_RATE = 0.12;
const SMALL_CONTEXT = 30_000;
const FEW_FILES = 5;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function complexity(sessions: Session[]) {
  const turns = sessions.flatMap((s) => s.turns);
  const main = sessions.filter((s) => !s.isSidechain);
  const prompt = (t: (typeof turns)[number]) =>
    t.usage.input + t.usage.cacheRead + t.usage.cacheWrite;
  const avgPrompt = turns.reduce((n, t) => n + prompt(t), 0) / Math.max(1, turns.length);
  const calls = turns.flatMap((t) => t.toolCalls);
  const edited = new Set(
    calls.filter((c) => EDIT_TOOLS.has(c.name) && c.target).map((c) => c.target),
  );
  const errorRate = calls.filter((c) => c.isError).length / Math.max(1, calls.length);
  const turnsPerSession = main.reduce((n, s) => n + s.turns.length, 0) / Math.max(1, main.length);

  let score = 0;
  const reasons: string[] = [];
  if (avgPrompt > BIG_CONTEXT) {
    score += avgPrompt > HUGE_CONTEXT ? 2 : 1;
    reasons.push(`ortalama bağlam ~${fmtTokens(avgPrompt)} token`);
  }
  if (edited.size > MANY_FILES) {
    score += edited.size > VERY_MANY_FILES ? 2 : 1;
    reasons.push(`${edited.size} farklı dosya düzenlendi`);
  }
  if (turnsPerSession > LONG_SESSION_TURNS) {
    score++;
    reasons.push(`oturum başı ~${Math.round(turnsPerSession)} tur`);
  }
  if (errorRate > HIGH_ERROR_RATE) {
    score++;
    reasons.push(`tool hata oranı %${Math.round(errorRate * 100)}`);
  }
  let requiredTier: number;
  if (score === 0 && edited.size <= FEW_FILES && avgPrompt < SMALL_CONTEXT) requiredTier = 1;
  else if (score <= 2) requiredTier = 2;
  else if (score <= 4) requiredTier = 3;
  else requiredTier = 4;
  if (!reasons.length) {
    reasons.push(
      requiredTier === 1
        ? 'kısa oturumlar, küçük bağlam, az dosya'
        : `belirgin zorluk sinyali yok (bağlam ~${fmtTokens(avgPrompt)}, ${edited.size} dosya)`,
    );
  }
  return { score, requiredTier, reasons };
}

export function computeModelAdvice(sessions: Session[]): ModelAdvice[] {
  const groups = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = `${s.tool}|${s.projectPath}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const out: ModelAdvice[] = [];
  for (const group of groups.values()) {
    const turns = group.flatMap((s) => s.turns);
    const byModel = new Map<string, number>();
    let currentCost = 0;
    for (const t of turns) {
      const c = usageCost(t.model, t.usage);
      if (c === undefined) continue;
      currentCost += c;
      const k = modelKey(t.model) ?? t.model ?? '?';
      byModel.set(k, (byModel.get(k) ?? 0) + c);
    }
    if (currentCost <= 0) continue;
    const cx = complexity(group);
    const currentModels = [...byModel.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([model, c]) => ({ model, share: c / currentCost }));
    const dominant = currentModels[0]?.model;
    const provider = providerOf(dominant ? MODELS[dominant] : undefined);
    const options: ModelOption[] = recommendable(provider)
      .filter(([, r]) => r.tier >= cx.requiredTier - 1)
      .map(([model, r]) => {
        const cost = turns.reduce((n, t) => n + costWithRates(r, t.usage), 0);
        let fit: ModelOption['fit'] =
          r.tier === cx.requiredTier ? 'recommended' : r.tier > cx.requiredTier ? 'ok' : 'risky';
        if (model === dominant) fit = 'current';
        return {
          model,
          label: r.label,
          tier: r.tier,
          costUSD: cost,
          savingsUSD: currentCost - cost,
          fit,
        };
      });
    const recommended = options
      .filter((o) => o.tier >= cx.requiredTier)
      .sort((a, b) => a.costUSD - b.costUSD)[0];
    out.push({
      tool: group[0]?.tool ?? 'claude-code',
      projectPath: group[0]?.projectPath ?? '(unknown)',
      sessions: group.filter((s) => !s.isSidechain).length,
      currentModels,
      currentCostUSD: currentCost,
      complexity: cx,
      options,
      recommended,
    });
  }
  return out.sort((a, b) => b.currentCostUSD - a.currentCostUSD);
}

export const modelFit: Analyzer = {
  id: 'model-fit',
  description: 'Projeyi daha düşük maliyetle bitirebilecek modeller',
  run(ctx) {
    return computeModelAdvice(ctx.sessions).flatMap<Finding>((a) => {
      const rec = a.recommended;
      const dominant = ratesFor(a.currentModels[0]?.model);
      if (!rec || !dominant || rec.savingsUSD <= 0.01 || rec.model === a.currentModels[0]?.model)
        return [];
      if (dominant.tier <= rec.tier) return [];
      return [
        {
          ruleId: 'model-fit',
          severity: rec.savingsUSD >= 50 ? 'medium' : rec.savingsUSD >= 5 ? 'low' : 'info',
          title: `${projectName(a.projectPath)}: ${dominant.label} yerine ${rec.label} yeterli görünüyor (~${fmtUSD(rec.savingsUSD)} tasarruf)`,
          detail: `Şu anki ~${fmtUSD(a.currentCostUSD)} → ~${fmtUSD(rec.costUSD)}. Gerekçe: ${a.complexity.reasons.join(', ')}. Aynı token kullanımı varsayılır (tokenizer ve tur sayısı farkı hesaba katılmaz).`,
          wastedTokens: 0,
          wastedTokensExact: false,
          scope: { tool: a.tool, projectPath: a.projectPath },
          evidence: a.options.map((o) => `${o.label}: ~${fmtUSD(o.costUSD)} (${o.fit})`),
          suggestion: `Bu projede varsayılan modeli ${rec.label} yap (/model); zor görevlerde daha güçlü modele geç.`,
        },
      ];
    });
  },
};
