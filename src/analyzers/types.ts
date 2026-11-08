import type { Thresholds } from '../constants.js';
import type { Finding, Inventory, Session } from '../model/types.js';

export interface AnalyzerContext {
  inventory: Inventory;
  sessions: Session[];
  thresholds: Thresholds;
  now: Date;
}

export interface Analyzer {
  id: string;
  description: string;
  run(ctx: AnalyzerContext): Finding[];
}
