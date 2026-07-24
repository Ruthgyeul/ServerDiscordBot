/** What a slash-command registration would change, by command name. */
export interface CommandDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Compare the command names currently registered with Discord against the ones
 * about to be published.
 *
 * Lives here rather than in `deploy-commands.ts` on purpose: that module is a
 * script that registers (and deletes) commands the moment it is imported, so
 * anything wanting to unit-test this logic must be able to reach it without
 * loading the script.
 */
export function diffCommandNames(before: string[], after: string[]): CommandDiff {
  const previous = new Set(before);
  const current = new Set(after);

  return {
    added: [...current].filter((name) => !previous.has(name)).sort(),
    removed: [...previous].filter((name) => !current.has(name)).sort(),
    unchanged: [...current].filter((name) => previous.has(name)).sort(),
  };
}

/** Render a diff as a readable suffix, quiet when nothing moved. */
export function describeDiff(diff: CommandDiff): string {
  const parts = [
    diff.added.length > 0 ? `added: ${diff.added.join(', ')}` : null,
    diff.removed.length > 0 ? `removed: ${diff.removed.join(', ')}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : ' · no changes';
}
