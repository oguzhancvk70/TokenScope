import type { InstalledTool, Session, ToolId } from '../model/types.js';

export interface LoadOptions {
  since?: Date;
  project?: string;
  redact: boolean;
}

export interface ParseStats {
  files: number;
  lines: number;
  skippedLines: number;
  unknownTypes: number;
}

export const emptyStats = (): ParseStats => ({
  files: 0,
  lines: 0,
  skippedLines: 0,
  unknownTypes: 0,
});

export interface Adapter {
  id: ToolId;
  detect(opts?: { projectPaths?: string[] }): Promise<InstalledTool | null>;
  loadSessions(opts: LoadOptions): AsyncIterable<Session>;
  stats(): ParseStats;
}
