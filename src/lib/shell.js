import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run a system command safely.
 *
 * We intentionally use `execFile` (NOT `exec`) with an explicit argument
 * array. Arguments are passed directly to the OS without going through a
 * shell, so there is no shell interpolation and therefore no command
 * injection surface, even if an argument contains spaces or metacharacters.
 *
 * @param {string} file - Executable to run (e.g. "systemctl").
 * @param {string[]} args - Argument list.
 * @param {object} [options]
 * @param {number} [options.timeoutMs=15000] - Kill the process after this long.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function run(file, args = [], { timeoutMs = 15000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1 MiB is plenty for status/log snippets
    });
    return { stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (error) {
    // execFile rejects on non-zero exit; surface a compact, useful error.
    const stderr = error.stderr?.toString().trim();
    const stdout = error.stdout?.toString().trim();
    const detail = stderr || stdout || error.message;
    const err = new Error(`Command failed: ${file} ${args.join(' ')} — ${detail}`);
    err.code = error.code;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
}
