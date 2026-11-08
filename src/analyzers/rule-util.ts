import type { InstructionRule } from '../model/types.js';
import { homeRel } from '../util/redact.js';

export const ruleLoc = (r: InstructionRule) => `${homeRel(r.source.path)}:${r.source.line}`;

export const shortText = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
