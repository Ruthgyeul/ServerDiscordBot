import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import { config } from '../../config/index.js';
import type { BotContext, CommandModule } from '../../types.js';

/**
 * List every available command, grouped by category. Reads live from the
 * loaded command collection, so newly added commands appear automatically.
 */
const command: CommandModule = {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show the list of available commands.'),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    const byCategory = new Map<string, string[]>();

    for (const entry of context.commands.values()) {
      const category = entry.category ?? 'general';
      const scope = entry.permission === Permission.EVERYONE ? '' : ' 🔒';
      const line = `**/${entry.data.name}**${scope} — ${entry.data.description}`;
      const lines = byCategory.get(category) ?? [];
      lines.push(line);
      byCategory.set(category, lines);
    }

    const embed = infoEmbed(
      `${config.bot.name} — Commands`,
      `${config.bot.description}\n\nCommands marked 🔒 require administrator access.`,
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

export default command;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
