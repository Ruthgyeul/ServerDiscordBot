import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';

/**
 * List every available command, grouped by category. Reads live from the
 * loaded command collection, so newly added commands appear automatically.
 * @type {import('../../handlers/commandLoader.js').Command}
 */
export default {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the list of available commands.'),

  async execute(interaction, context) {
    /** @type {Map<string, string[]>} */
    const byCategory = new Map();

    for (const command of context.commands.values()) {
      const category = command.category ?? 'general';
      const scope = command.permission === Permission.EVERYONE ? '' : ' 🔒';
      const line = `**/${command.data.name}**${scope} — ${command.data.description}`;
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(line);
    }

    const embed = infoEmbed(
      'ServerDiscordBot — Commands',
      'Commands marked 🔒 require administrator access.',
    );

    for (const [category, lines] of [...byCategory.entries()].sort()) {
      embed.addFields({
        name: capitalize(category),
        value: lines.sort().join('\n'),
      });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

/**
 * @param {string} text
 */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
