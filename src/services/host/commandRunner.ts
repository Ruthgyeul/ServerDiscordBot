import { run } from '../../lib/shell.js';
import { findCommand } from '../../config/index.js';
import { childLogger } from '../../logger.js';
import type { RunCommandConfig } from '../../types/index.js';

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

/** Characters an argument may contain at all. Blocks shell metacharacters. */
const SAFE_CHARS = /^[\w@%+=:,./-]+$/;

/** Caps on caller-supplied arguments, so a pathological input stays cheap. */
const MAX_ARGS = 8;
const MAX_ARG_LENGTH = 256;

/**
 * Split a caller-supplied argument string into individual, validated arguments.
 *
 * Two layers, doing different jobs:
 *
 *  - `SAFE_CHARS` stops shell metacharacters. Combined with execFile this is
 *    what makes injection impossible.
 *  - `argPattern`, when the entry sets one, constrains what the arguments may
 *    *mean*. That is a separate problem: `/etc/shadow` contains no dangerous
 *    characters at all, and passing it to a command that reads files would
 *    walk straight around the `files` allowlist.
 *
 * @param argPattern Optional anchored expression from the entry's config.
 */
export function parseExtraArgs(raw: string, argPattern = ''): string[] {
  const parts = raw.trim().split(/\s+/).filter(Boolean);

  if (parts.length > MAX_ARGS) {
    throw new Error(`Too many arguments (${parts.length}); at most ${MAX_ARGS} are accepted.`);
  }

  const constraint = argPattern ? new RegExp(argPattern) : null;

  for (const part of parts) {
    if (part.length > MAX_ARG_LENGTH) {
      throw new Error(`Argument is too long (limit ${MAX_ARG_LENGTH} characters).`);
    }
    if (!SAFE_CHARS.test(part)) {
      throw new Error(
        `Argument "${part}" contains characters that are not allowed. ` +
          'Use letters, digits and . _ - / : , = + % @ only.',
      );
    }
    if (constraint && !constraint.test(part)) {
      throw new Error(
        `Argument "${part}" is not permitted for this command ` +
          `(must match \`${argPattern}\`).`,
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
  // Re-validate here rather than trusting the caller to have done it. This
  // function is the security boundary; the command layer is convenience.
  if (extra.length > 0) parseExtraArgs(extra.join(' '), entry.argPattern);

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
