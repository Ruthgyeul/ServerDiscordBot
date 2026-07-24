import {
  SlashCommandBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type SlashCommandStringOption,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config, findService } from '../../config/index.js';
import {
  controlService,
  getStatus,
  getAllStatuses,
  getLogs,
  ServiceAction,
} from '../../services/serviceManager.js';
import { infoEmbed, successEmbed } from '../../lib/embeds.js';
import { respondWithEntries } from '../../lib/autocomplete.js';
import { confirmAction } from '../../lib/confirm.js';
import { recordAudit } from '../../services/audit.js';
import { truncate } from '../../lib/format.js';
import { childLogger } from '../../logger.js';
import type { BotContext, CommandModule } from '../../types.js';

const log = childLogger('command:service');

/**
 * Reusable "name" option for the subcommands that target a single unit.
 *
 * Values are served by autocomplete rather than baked in as static choices, so
 * a service added to `config.json` becomes selectable right after a `/config
 * reload` — no re-registration with Discord, no restart.
 */
function nameOption(option: SlashCommandStringOption): SlashCommandStringOption {
  return option
    .setName('name')
    .setDescription('The managed service to target.')
    .setRequired(true)
    .setAutocomplete(true);
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
        )
        .addStringOption((opt) =>
          opt
            .setName('priority')
            .setDescription('Only show messages at this priority or worse.')
            .addChoices(
              { name: 'Errors and worse', value: 'err' },
              { name: 'Warnings and worse', value: 'warning' },
              { name: 'Everything', value: 'debug' },
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'list':
        return handleList(interaction);
      case 'status':
        return handleStatus(interaction);
      case 'logs':
        return handleLogs(interaction);
      default:
        return handleControl(interaction, sub, context);
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await respondWithEntries(interaction, config.services);
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
    const critical = s.service.critical ? ' ❗' : '';
    return `${icon} **${s.service.label}**${critical} \`${s.service.unit}\` — ${s.activeState}/${s.subState}`;
  });

  const up = statuses.filter((s) => s.running).length;
  await interaction.editReply({
    embeds: [infoEmbed(`Managed services — ${up}/${statuses.length} up`, lines.join('\n'))],
  });
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const name = interaction.options.getString('name', true);
  const status = await getStatus(name);
  const icon = status.running ? '🟢 Running' : '🔴 Not running';

  await interaction.editReply({
    embeds: [
      infoEmbed(status.service.label, status.service.description).addFields(
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
  const priority = interaction.options.getString('priority') ?? undefined;
  const output = await getLogs(name, lines, priority);

  await interaction.editReply({
    embeds: [infoEmbed(`Logs — ${name}`, `\`\`\`\n${truncate(output)}\n\`\`\``)],
  });
}

/**
 * Handle start/stop/restart.
 *
 * Taking a service marked `critical` down asks for confirmation first: one
 * mistyped autocomplete entry on `nginx` is the difference between restarting
 * one app and taking every hosted site offline. Starting a service is never
 * gated — it only ever moves things towards working.
 */
async function handleControl(
  interaction: ChatInputCommandInteraction,
  action: string,
  context: BotContext,
): Promise<void> {
  const name = interaction.options.getString('name', true);

  const mutating: ServiceAction[] = [
    ServiceAction.START,
    ServiceAction.STOP,
    ServiceAction.RESTART,
  ];
  const resolved = mutating.find((a) => a === action);
  if (!resolved) throw new Error(`Unsupported action "${action}".`);

  const service = findService(name);
  if (!service) throw new Error(`Unknown service "${name}". Not in the managed allowlist.`);

  const needsConfirmation = service.critical && resolved !== ServiceAction.START;
  if (needsConfirmation) {
    const confirmed = await confirmAction(interaction, {
      title: `${capitalize(resolved)} a critical service?`,
      description: `**${service.label}** (\`${service.unit}\`) is marked critical.${
        service.description ? `\n${service.description}` : ''
      }`,
      confirmLabel: `${capitalize(resolved)} ${service.name}`,
    });
    if (!confirmed) return;
  } else {
    // Deferred because a slow service can take several seconds to change state.
    await interaction.deferReply();
  }

  const result = await controlService(name, resolved);
  log.info(
    { user: interaction.user.tag, service: name, action: resolved },
    'service action performed via Discord',
  );
  recordAudit(context.client, {
    actor: interaction.user.tag,
    action: `service.${resolved}`,
    target: service.unit,
    detail: service.critical ? '**Critical service.**' : undefined,
  });

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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
