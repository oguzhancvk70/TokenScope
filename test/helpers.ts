import { fileURLToPath } from 'node:url';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../src/constants.js';
import { runScan } from '../src/scan.js';

export const FIXTURE_HOME = fileURLToPath(new URL('./fixtures/claude-code/home', import.meta.url));
export const NOW = new Date('2026-11-08T12:00:00Z');

export const LOW_THRESHOLDS: Thresholds = {
  ...DEFAULT_THRESHOLDS,
  staticItemWarnTokens: 1_000,
  hugeOutputTokens: 500,
};

export const scanFixture = (thresholds: Thresholds = LOW_THRESHOLDS) =>
  runScan({ homeDir: FIXTURE_HOME, redact: true, thresholds, now: NOW });
