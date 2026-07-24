import {
  SlashCommandBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config, findCommand } from '../../config/index.js';
import { parseExtraArgs, runCommand } from '../../services/commandRunner.js';
import { infoEmbed, successEmbed } from '../../lib/embeds.js';
import { respondWithEntries } from '../../lib/autocomplete.js';
import { confirmAction } from '../../lib/confirm.js';
import { recordAudit } from '../../services/audit.js';
import { truncate } from '../../lib/format.js';
import type { BotContext, CommandModule } from '../../types.js';

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

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    if (interaction.options.getSubcommand() === 'list') {
      return handleList(interaction);
    }
    return handleExec(interaction, context);
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
          'Add entries under `"commands"` in `config.json`, then run `/config reload`.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = config.commands.map((entry) => {
    const argv = [entry.command, ...entry.args].join(' ');
    const flags = [
      entry.sudo ? 'sudo' : null,
      entry.allowArgs ? 'accepts args' : null,
      entry.confirm ? 'asks first' : null,
    ].filter(Boolean);
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

async function handleExec(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
): Promise<void> {
  const name = interaction.options.getString('name', true);
  const rawArgs = interaction.options.getString('args');
  const extra = rawArgs ? parseExtraArgs(rawArgs) : [];

  // Entries that change something opt into a confirmation step with
  // "confirm": true, so a reload or a deploy cannot be fired by a stray Enter.
  const entry = findCommand(name);
  if (entry?.confirm) {
    const preview = [entry.command, ...entry.args, ...extra].join(' ');
    const confirmed = await confirmAction(interaction, {
      title: `Run ${entry.label}?`,
      description: `\`${preview}\`${entry.description ? `\n${entry.description}` : ''}`,
      confirmLabel: `Run ${entry.name}`,
    });
    if (!confirmed) return;
  } else {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const outcome = await runCommand(name, extra, interaction.user.tag);
  recordAudit(context.client, {
    actor: interaction.user.tag,
    action: 'run.exec',
    target: outcome.entry.name,
    detail: `\`${outcome.argv.join(' ')}\``,
  });
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
