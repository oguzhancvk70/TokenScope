export const PKG_NAME = 'tokenscope';
export const CLI_NAME = 'tokenscope';
export const VERSION = '0.1.0';

export const DEFAULT_SINCE = '30d';

// varsayılan eşikler (--config ile ezilebilir)
export const DEFAULT_THRESHOLDS = {
  staticItemWarnTokens: 2_000,
  deadWeightDays: 30,
  repeatedReadsMin: 3,
  hugeOutputTokens: 10_000,
  errorLoopMin: 3,
} as const;

export type Thresholds = { -readonly [K in keyof typeof DEFAULT_THRESHOLDS]: number };
