import type { Finding } from '../model/types.js';
import { deadWeight } from './dead-weight.js';
import { errorLoops } from './error-loops.js';
import { hugeToolOutput } from './huge-tool-output.js';
import { modelFit } from './model-fit.js';
import { repeatedReads } from './repeated-reads.js';
import { staticContextTax } from './static-context-tax.js';
import type { Analyzer, AnalyzerContext } from './types.js';

export const ANALYZERS: Analyzer[] = [
  staticContextTax,
  deadWeight,
  hugeToolOutput,
  repeatedReads,
  errorLoops,
  modelFit,
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
