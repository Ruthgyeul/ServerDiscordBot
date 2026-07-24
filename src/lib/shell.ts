import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Kill the process after this long (default 15000). */
  timeoutMs?: number;
}

/** Error thrown when a command exits non-zero, carrying its output. */
export interface CommandError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

/**
 * Run a system command safely.
 *
 * We intentionally use `execFile` (NOT `exec`) with an explicit argument
 * array. Arguments are passed directly to the OS without going through a
 * shell, so there is no shell interpolation and therefore no command
 * injection surface, even if an argument contains spaces or metacharacters.
 */
export async function run(
  file: string,
  args: string[] = [],
  { timeoutMs = 15000 }: RunOptions = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1 MiB is plenty for status/log snippets
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (rawError) {
    // execFile rejects on non-zero exit; surface a compact, useful error.
    const error = rawError as CommandError;
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const detail = stderr || stdout || error.message;
    const err: CommandError = new Error(
      `Command failed: ${file} ${args.join(' ')} — ${detail}`,
    );
    err.code = error.code;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
}
