import type { Finding } from '../model/types.js';
import { conflictingRules } from './conflicting-rules.js';
import { deadRules } from './dead-rules.js';
import { deadWeight } from './dead-weight.js';
import { duplicateCode } from './duplicate-code.js';
import { errorLoops } from './error-loops.js';
import { hugeToolOutput } from './huge-tool-output.js';
import { modelFit } from './model-fit.js';
import { repeatedReads } from './repeated-reads.js';
import { ruleViolations } from './rule-violations.js';
import { staleRules } from './stale-rules.js';
import { staticContextTax } from './static-context-tax.js';
import type { Analyzer, AnalyzerContext } from './types.js';

export const ANALYZERS: Analyzer[] = [
  staticContextTax,
  deadWeight,
  hugeToolOutput,
  repeatedReads,
  errorLoops,
  modelFit,
  staleRules,
  ruleViolations,
  deadRules,
  conflictingRules,
  duplicateCode,
];

export function runAnalyzers(
  ctx: AnalyzerContext,
  warn: (msg: string) => void = () => {},
): Finding[] {
  const findings: Finding[] = [];
  for (const a of ANALYZERS) {
    try {
      findings.push(...a.run(ctx));
    } catch (e) {
      warn(`${a.id} analyzer hata verdi: ${(e as Error).message}`);
    }
  }
  return findings.sort((a, b) => b.wastedTokens - a.wastedTokens);
}
