import type { Thresholds } from '../constants.js';
import type {
  DuplicationSummary,
  Finding,
  Inventory,
  RuleAuditResult,
  Session,
} from '../model/types.js';

export interface AnalyzerContext {
  inventory: Inventory;
  sessions: Session[];
  thresholds: Thresholds;
  now: Date;
  audit?: RuleAuditResult[];
  duplication?: DuplicationSummary[];
}

export interface Analyzer {
  id: string;
  description: string;
  run(ctx: AnalyzerContext): Finding[];
}
