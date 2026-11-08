import { runAnalyzers } from '../analyzers/index.js';
import type { Thresholds } from '../constants.js';
import type {
  ChangeEvent,
  Comparison,
  InstructionRule,
  Inventory,
  Session,
} from '../model/types.js';
import { auditRules } from '../rules-audit/audit.js';
import { periodMetrics } from './metrics.js';

export interface CompareInput {
  inventory: Inventory;
  sessions: Session[];
  thresholds: Thresholds;
  now: Date;
  home: string;
  rules?: InstructionRule[];
  withFindings?: boolean;
}

const inScope = (e: ChangeEvent, s: Session) =>
  !e.projectPath ||
  s.projectPath === e.projectPath ||
  s.projectPath.startsWith(`${e.projectPath}/`);

export async function compareEvent(event: ChangeEvent, input: CompareInput): Promise<Comparison> {
  const scoped = input.sessions.filter((s) => inScope(event, s));
  const t = event.at.getTime();
  const sides = [
    scoped.filter((s) => s.startedAt.getTime() < t),
    scoped.filter((s) => s.startedAt.getTime() >= t),
  ] as const;
  const [before, after] = await Promise.all(
    sides.map(async (list, i) => {
      const from =
        i === 0 ? (list.map((s) => s.startedAt).sort((a, b) => +a - +b)[0] ?? event.at) : event.at;
      const to = i === 0 ? event.at : input.now;
      if (!input.withFindings) return periodMetrics(list, from, to);
      const audit = input.rules ? await auditRules(input.rules, list, input.home) : [];
      const findings = runAnalyzers({
        inventory: input.inventory,
        sessions: list,
        thresholds: input.thresholds,
        now: input.now,
        audit,
      });
      const violations = audit.reduce((n, r) => n + r.violations, 0);
      return periodMetrics(list, from, to, findings, input.rules ? violations : undefined);
    }),
  );
  const min = input.thresholds.impactMinSessions;
  return {
    event,
    before: before!,
    after: after!,
    sufficientData: before!.sessions >= min && after!.sessions >= min,
    minSessions: min,
  };
}

// verisi yeterli en yeni olay; hiçbiri yeterli değilse en yenisi
export async function latestComparable(
  events: ChangeEvent[],
  input: CompareInput,
): Promise<ChangeEvent | undefined> {
  const past = events.filter((e) => e.at <= input.now);
  for (const e of [...past].reverse())
    if ((await compareEvent(e, { ...input, withFindings: false })).sufficientData) return e;
  return past.at(-1);
}
