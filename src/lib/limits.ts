/**
 * Discord's payload limits, and helpers for staying inside them.
 *
 * Every list this bot renders — services, websites, allowlisted commands and
 * files, listening ports, config issues — grows with the server it manages.
 * Building a description by joining N entries works fine at three entries and
 * fails the whole interaction with a 400 at thirty, which is exactly when an
 * operator most needs the output. These helpers cut on entry boundaries and
 * say what was left out, so a long list degrades into a shorter list instead
 * of an error.
 */

/** Hard limits enforced by the Discord API. */
export const DiscordLimits = {
  embedDescription: 4096,
  embedFieldValue: 1024,
  embedFieldName: 256,
  embedTitle: 256,
  /** Sum of all text across one embed. */
  embedTotal: 6000,
  messageContent: 2000,
  autocompleteChoices: 25,
  /** Choices, subcommands and options per command. */
  commandOptions: 25,
} as const;

/**
 * Join entries with `separator`, keeping only those that fit in `max`.
 *
 * Cuts between entries, never inside one, and appends a note naming how many
 * were dropped — silence would leave the reader believing they saw everything.
 */
export function fitEntries(entries: string[], max: number, separator = '\n'): string {
  if (entries.length === 0) return '';

  const kept: string[] = [];
  let length = 0;

  for (const [index, entry] of entries.entries()) {
    const remaining = entries.length - index;
    // Reserve room for the note, but only once something will actually be cut.
    const note = remaining > 1 ? overflowNote(remaining) : '';
    const addition = (kept.length > 0 ? separator.length : 0) + entry.length;

    if (length + addition + (note ? separator.length + note.length : 0) > max) {
      if (kept.length === 0) {
        // A single entry too large to show at all: truncate it rather than
        // returning an empty field.
        return truncateText(entry, max);
      }
      return [...kept, overflowNote(remaining)].join(separator);
    }

    kept.push(entry);
    length += addition;
  }

  return kept.join(separator);
}

function overflowNote(remaining: number): string {
  return `_… and ${remaining} more_`;
}

/** Hard-truncate a string with an ellipsis, for values with no entry structure. */
export function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Wrap text in a fenced code block sized to fit `max`, fences included.
 *
 * Callers otherwise have to remember to subtract the fence characters, and the
 * failure mode is a 400 rather than a visibly clipped block.
 */
export function codeBlock(text: string, max: number = DiscordLimits.embedDescription): string {
  const fence = '```\n\n```'.length;
  const body = truncateText(text, Math.max(0, max - fence));
  return `\`\`\`\n${body}\n\`\`\``;
}
