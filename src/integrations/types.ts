export interface Integration<T> {
  id: 'jscpd' | 'git-ai' | (string & {});
  isAvailable(projectPath: string): Promise<boolean>;
  collect(projectPath: string): Promise<T | null>;
}
