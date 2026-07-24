import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config.js';
import {
  controlService,
  getStatus,
  getAllStatuses,
  getLogs,
  ServiceAction,
} from '../../services/serviceManager.js';
import { infoEmbed, successEmbed } from '../../lib/embeds.js';
import { truncate } from '../../lib/format.js';
import { childLogger } from '../../logger.js';
import type { CommandModule } from '../../types.js';

const log = childLogger('command:service');

/**
 * Build the choices array from managed services so users get dropdowns and can
 * never target a unit outside the allowlist.
 */
function serviceChoices(): { name: string; value: string }[] {
  return config.services.slice(0, 25).map((s) => ({ name: s.label, value: s.name }));
}

/** Reusable "name" option builder for the mutating/inspecting subcommands. */
function nameOption(option: SlashCommandStringOption): SlashCommandStringOption {
  option.setName('name').setDescription('The managed service to target.').setRequired(true);
  for (const choice of serviceChoices()) option.addChoices(choice);
  return option;
}

/**
 * `/service` — manage the systemd units registered in config.
 * Mutating subcommands are admin-only (the command's default); `list` and
 * `status` are read-only but kept admin-gated too, since exposing internal
 * service topology is itself sensitive. Adjust `permission` to taste.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('service')
    .setDescription('Manage the systemd services registered with the bot.')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List all managed services and their state.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription('Show detailed status for one service.')
        .addStringOption(nameOption),
    )
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start a service.').addStringOption(nameOption),
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop a service.').addStringOption(nameOption),
    )
    .addSubcommand((sub) =>
      sub.setName('restart').setDescription('Restart a service.').addStringOption(nameOption),
    )
    .addSubcommand((sub) =>
      sub
        .setName('logs')
        .setDescription('Show recent journal logs for a service.')
        .addStringOption(nameOption)
        .addIntegerOption((opt) =>
          opt
            .setName('lines')
            .setDescription('Number of log lines (1–100, default 30).')
            .setMinValue(1)
            .setMaxValue(100),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'list':
        return handleList(interaction);
      case 'status':
        return handleStatus(interaction);
      case 'logs':
        return handleLogs(interaction);
      default:
        return handleControl(interaction, sub);
    }
  },
};

export default command;

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (config.services.length === 0) {
    await interaction.editReply({
      embeds: [infoEmbed('No managed services', 'Add services in `config/config.json`.')],
    });
    return;
  }

  const statuses = await getAllStatuses();
  const lines = statuses.map((s) => {
    const icon = s.running ? '🟢' : '🔴';
    return `${icon} **${s.service.label}** \`${s.service.unit}\` — ${s.activeState}/${s.subState}`;
  });

  await interaction.editReply({
    embeds: [infoEmbed('Managed services', lines.join('\n'))],
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = interaction.options.getString('name', true);
  const status = await getStatus(name);
  const icon = status.running ? '🟢 Running' : '🔴 Not running';

  await interaction.editReply({
    embeds: [
      infoEmbed(status.service.label).addFields(
        { name: 'Unit', value: `\`${status.service.unit}\``, inline: true },
        { name: 'State', value: icon, inline: true },
        {
          name: 'Detail',
          value: `${status.activeState} / ${status.subState} (${status.loadState})`,
          inline: false,
        },
        { name: 'Active since', value: status.since || '—', inline: false },
      ),
    ],
  });
}

async function handleLogs(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = interaction.options.getString('name', true);
  const lines = interaction.options.getInteger('lines') ?? 30;
  const output = await getLogs(name, lines);

  await interaction.editReply({
    embeds: [infoEmbed(`Logs — ${name}`, `\`\`\`\n${truncate(output)}\n\`\`\``)],
  });
}

/**
 * Handle start/stop/restart. Deferred because a slow service can take several
 * seconds to change state.
 */
async function handleControl(
  interaction: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  await interaction.deferReply();
  const name = interaction.options.getString('name', true);

  const mutating: ServiceAction[] = [
    ServiceAction.START,
    ServiceAction.STOP,
    ServiceAction.RESTART,
  ];
  const resolved = mutating.find((a) => a === action);
  if (!resolved) throw new Error(`Unsupported action "${action}".`);

  const result = await controlService(name, resolved);
  log.info(
    { user: interaction.user.tag, service: name, action: resolved },
    'service action performed via Discord',
  );

  // Re-read status so the confirmation reflects reality, not just the exit code.
  const status = await getStatus(name);
  const icon = status.running ? '🟢 Running' : '🔴 Stopped';
  const pastTense: Record<ServiceAction, string> = {
    [ServiceAction.START]: 'Started',
    [ServiceAction.STOP]: 'Stopped',
    [ServiceAction.RESTART]: 'Restarted',
    [ServiceAction.STATUS]: 'Checked',
  };

  await interaction.editReply({
    embeds: [
      successEmbed(
        `${pastTense[resolved]} ${result.service.label}`,
        `New state: ${icon} (${status.activeState}/${status.subState})`,
      ),
    ],
  });
}
