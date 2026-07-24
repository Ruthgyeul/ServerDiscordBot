import {
  SlashCommandBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config/index.js';
import { listFiles, tailFile } from '../../services/fileViewer.js';
import { infoEmbed } from '../../lib/embeds.js';
import { respondWithEntries } from '../../lib/autocomplete.js';
import { formatBytes, truncate } from '../../lib/format.js';
import type { CommandModule } from '../../types.js';

/**
 * `/file` — read the tail of a file allowlisted in `config.files`.
 *
 * Aimed at the logs systemd does not own: nginx access/error logs, an app's
 * own log file, a deploy manifest. Read-only by construction — there is no
 * write path — and the caller names a config key, never a path.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('file')
    .setDescription('Read allowlisted files on the server.')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Show which files are allowlisted.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('tail')
        .setDescription('Show the last lines of an allowlisted file.')
        .addStringOption((opt) =>
          opt
            .setName('name')
            .setDescription('Which file to read.')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addIntegerOption((opt) =>
          opt
            .setName('lines')
            .setDescription('How many lines (default 30).')
            .setMinValue(1)
            .setMaxValue(1000),
        )
        .addStringOption((opt) =>
          opt.setName('contains').setDescription('Only show lines containing this text.'),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.options.getSubcommand() === 'list') {
      return handleList(interaction);
    }
    return handleTail(interaction);
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await respondWithEntries(interaction, config.files);
  },
};

export default command;

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (config.files.length === 0) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          'No files allowlisted',
          'Add entries under `"files"` in `config/config.json`, then run `/config reload`.',
        ),
      ],
    });
    return;
  }

  const lines = (await listFiles()).map((info) => {
    const icon = info.readable ? '📄' : '⚠️';
    const detail = info.readable
      ? `${formatBytes(info.size)} · modified <t:${Math.floor((info.modified?.getTime() ?? 0) / 1000)}:R>`
      : info.error;
    return `${icon} **${info.entry.label}** (\`${info.entry.name}\`)\n\`${info.entry.path}\`\n${detail}`;
  });

  await interaction.editReply({
    embeds: [infoEmbed(`Allowlisted files (${config.files.length})`, lines.join('\n\n'))],
  });
}

async function handleTail(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const name = interaction.options.getString('name', true);
  const lines = interaction.options.getInteger('lines') ?? 30;
  const contains = interaction.options.getString('contains') ?? undefined;

  const result = await tailFile(name, lines, contains);
  const body = result.lines.join('\n') || '(no matching lines)';
  const notes = [
    `${formatBytes(result.size)} total`,
    contains ? `filtered by "${contains}"` : null,
    result.truncated ? 'searched the tail of the file only' : null,
  ].filter(Boolean);

  await interaction.editReply({
    embeds: [
      infoEmbed(
        `${result.entry.label} — last ${result.lines.length} line(s)`,
        `\`${result.entry.path}\` · ${notes.join(' · ')}\n\`\`\`\n${truncate(body, 1500)}\n\`\`\``,
      ),
    ],
  });
}
