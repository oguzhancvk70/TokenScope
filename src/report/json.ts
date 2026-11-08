import { CLI_NAME, VERSION } from '../constants.js';
import type { ScanResult } from '../scan.js';

// oturum ayrıntısı JSON'a girmez; ev dizini her yerde "~" olur
export function toJson(
  r: ScanResult,
  home: string,
  opts: { includeInventory?: boolean } = {},
): string {
  const prefix = `${home}/`;
  const replacer = (_key: string, value: unknown) =>
    typeof value === 'string' && value.includes(prefix) ? value.split(prefix).join('~/') : value;
  return JSON.stringify(
    {
      tool: CLI_NAME,
      version: VERSION,
      generatedAt: new Date().toISOString(),
      summary: r.summary,
      findings: r.findings,
      modelAdvice: r.modelAdvice,
      ...(opts.includeInventory === false ? {} : { inventory: r.inventory }),
    },
    replacer,
    2,
  );
}
