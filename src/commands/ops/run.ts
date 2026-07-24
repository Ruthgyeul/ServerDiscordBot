import {
  SlashCommandBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config/index.js';
import { parseExtraArgs, runCommand } from '../../services/commandRunner.js';
import { infoEmbed, successEmbed } from '../../lib/embeds.js';
import { respondWithEntries } from '../../lib/autocomplete.js';
import { truncate } from '../../lib/format.js';
import type { CommandModule } from '../../types.js';

/**
 * `/run` — execute one of the commands allowlisted in `config.commands`.
 *
 * This is the extension point for "I keep SSHing in to type the same thing":
 * add an entry to `config.json`, `/config reload`, and it is available in
 * Discord. Nothing here can run a command that is not in that list, and the
 * list itself is the only place a new capability can be granted.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('run')
    .setDescription('Run an allowlisted server command.')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Show which commands are allowlisted.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('exec')
        .setDescription('Run one allowlisted command.')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Which command to run.')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('args')
            .setDescription('Extra arguments (only for entries with allowArgs).'),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.options.getSubcommand() === 'list') {
      return handleList(interaction);
    }
    return handleExec(interaction);
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await respondWithEntries(interaction, config.commands);
  },
};

export default command;

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (config.commands.length === 0) {
    await interaction.reply({
      embeds: [
        infoEmbed(
          'No commands allowlisted',
          'Add entries under `"commands"` in `config/config.json`, then run `/config reload`.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = config.commands.map((entry) => {
    const argv = [entry.command, ...entry.args].join(' ');
    const flags = [entry.sudo ? 'sudo' : null, entry.allowArgs ? 'accepts args' : null].filter(
      Boolean,
    );
    const suffix = flags.length > 0 ? ` · _${flags.join(', ')}_` : '';
    return `**${entry.label}** (\`${entry.name}\`)${suffix}\n\`${argv}\`${entry.description ? `\n${entry.description}` : ''}`;
  });

  await interaction.reply({
    embeds: [
      infoEmbed(`Allowlisted commands (${config.commands.length})`, lines.join('\n\n')),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleExec(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString('name', true);
  const rawArgs = interaction.options.getString('args');
  const extra = rawArgs ? parseExtraArgs(rawArgs) : [];

  const outcome = await runCommand(name, extra, interaction.user.tag);
  const body = [outcome.stdout, outcome.stderr].filter(Boolean).join('\n') || '(no output)';

  await interaction.editReply({
    embeds: [
      successEmbed(
        outcome.entry.label,
        `\`${outcome.argv.join(' ')}\` · ${outcome.durationMs} ms\n\`\`\`\n${truncate(body, 1500)}\n\`\`\``,
      ),
    ],
  });
}
