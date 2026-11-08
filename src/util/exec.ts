import { execFile } from 'node:child_process';

// salt okunur alt süreç; hata/zaman aşımında undefined
export function run(cmd: string, args: string[], cwd?: string, timeout = 20_000) {
  return new Promise<string | undefined>((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? undefined : stdout),
    );
  });
}
