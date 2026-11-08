import type { RuleKind } from '../../model/types.js';
import { checkForbiddenCommand } from './forbidden-command.js';
import { checkForbiddenPath } from './forbidden-path.js';
import { checkPackageManager } from './package-manager.js';
import { checkPathReference } from './path-reference.js';
import { checkRequiredCommand } from './required-command.js';
import { checkScriptReference } from './script-reference.js';
import type { Check } from './types.js';

export const CHECKS: Record<Exclude<RuleKind, 'unclassified'>, Check> = {
  'package-manager': checkPackageManager,
  'forbidden-path': checkForbiddenPath,
  'forbidden-command': checkForbiddenCommand,
  'required-command': checkRequiredCommand,
  'path-reference': checkPathReference,
  'script-reference': checkScriptReference,
};

// loglarla ölçülen (diskle değil) kural tipleri
export const LOG_KINDS = new Set<RuleKind>([
  'package-manager',
  'forbidden-path',
  'forbidden-command',
  'required-command',
]);
