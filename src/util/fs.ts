import { readFile, stat } from 'node:fs/promises';

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export async function readJson<T = unknown>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
