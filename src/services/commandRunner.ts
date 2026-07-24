import { run } from '../lib/shell.js';
import { findCommand } from '../config/index.js';
import { childLogger } from '../logger.js';
import type { RunCommandConfig } from '../types.js';

const log = childLogger('commandRunner');

/**
 * Runs the shell commands declared in `config.commands`.
 *
 * Two independent guarantees keep this safe to expose over Discord:
 *
 *  1. **Allowlist.** Only a command defined in config.json can be named. There
 *     is no code path that runs a string supplied by a Discord user.
 *  2. **No shell.** `run()` uses execFile with an explicit argv, so arguments
 *     are handed to the OS verbatim — quoting, `;`, `&&`, backticks and globs
 *     have no special meaning and cannot escape into a new command.
 *
 * Extra arguments from the caller are therefore *arguments*, never syntax —
 * but they are still only accepted when the entry opts in with `allowArgs`,
 * because an extra argument can still change what a command does (`rm -rf`).
 */

export interface RunOutcome {
  entry: RunCommandConfig;
  /** The full argv actually executed, for the audit trail and the reply. */
  argv: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Arguments the caller may not smuggle in even when `allowArgs` is set. */
const ARG_PATTERN = /^[\w@%+=:,./-]+$/;

/** Split a user-supplied argument string into individual, validated arguments. */
export function parseExtraArgs(raw: string): string[] {
  const parts = raw.trim().split(/\s+/).filter(Boolean);

  for (const part of parts) {
    if (!ARG_PATTERN.test(part)) {
      throw new Error(
        `Argument "${part}" contains characters that are not allowed. ` +
          'Use letters, digits and . _ - / : , = + % @ only.',
      );
    }
  }
  return parts;
}

/**
 * Execute an allowlisted command.
 *
 * @param name  Key from `config.commands`.
 * @param extra Additional arguments; rejected unless the entry allows them.
 * @param actor Who asked, recorded in the audit log.
 */
export async function runCommand(
  name: string,
  extra: string[] = [],
  actor = 'system',
): Promise<RunOutcome> {
  const entry = findCommand(name);
  if (!entry) {
    throw new Error(`Unknown command "${name}". Not in the allowlist.`);
  }
  if (extra.length > 0 && !entry.allowArgs) {
    throw new Error(
      `"${entry.name}" does not accept extra arguments. ` +
        'Set "allowArgs": true for it in config.json to permit them.',
    );
  }

  const commandArgs = [...entry.args, ...extra];
  const invocation = entry.sudo
    ? { file: 'sudo', args: ['-n', entry.command, ...commandArgs] }
    : { file: entry.command, args: commandArgs };

  const argv = [invocation.file, ...invocation.args];
  log.info({ actor, command: entry.name, argv }, 'running allowlisted command');

  const startedAt = performance.now();
  const { stdout, stderr } = await run(invocation.file, invocation.args, {
    timeoutMs: entry.timeoutMs,
  });

  return {
    entry,
    argv,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    durationMs: Math.round(performance.now() - startedAt),
  };
}
