import type { InstructionRule, ToolId } from '../model/types.js';

// kural tek araca aitse bulgu o araca yazılır
export const soleTool = (r: InstructionRule | undefined): ToolId | undefined =>
  r?.source.tools?.length === 1 ? r.source.tools[0] : undefined;
