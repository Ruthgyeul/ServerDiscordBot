import type { AutocompleteInteraction } from 'discord.js';
import type { NamedEntry } from '../types.js';

/** Discord caps an autocomplete response at 25 choices. */
const MAX_CHOICES = 25;

/**
 * Answer an autocomplete interaction from a config-backed inventory list.
 *
 * Using autocomplete rather than static choices is what makes the inventory
 * genuinely hot-swappable: choices are computed per keystroke from the live
 * config, so adding a website or service to `config.json` (plus `/config
 * reload`) makes it selectable immediately — no `npm run deploy`, no restart.
 */
export async function respondWithEntries(
  interaction: AutocompleteInteraction,
  entries: NamedEntry[],
): Promise<void> {
  const query = interaction.options.getFocused().trim().toLowerCase();

  const matches = entries.filter((entry) => {
    if (!query) return true;
    return (
      entry.name.toLowerCase().includes(query) || entry.label.toLowerCase().includes(query)
    );
  });

  await interaction.respond(
    matches.slice(0, MAX_CHOICES).map((entry) => ({
      // Show the label, submit the stable key the command actually resolves.
      name: entry.label === entry.name ? entry.name : `${entry.label} (${entry.name})`,
      value: entry.name,
    })),
  );
}
