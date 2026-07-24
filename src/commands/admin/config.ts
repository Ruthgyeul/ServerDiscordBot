import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config, configIssues, reloadConfig } from '../../config/index.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../lib/embeds.js';
import { metricsHistory } from '../../services/monitor/metricsHistory.js';
import { DiscordLimits, fitEntries } from '../../lib/limits.js';
import { childLogger } from '../../logger.js';
import type { BotContext, CommandModule, ConfigIssue } from '../../types/index.js';

const log = childLogger('command:config');

/**
 * `/config` — inspect and hot-reload the bot's configuration.
 *
 * This is the command that makes the whole config story usable day to day:
 * edit `.env` or `config.json` on the server, run `/config reload`, and
 * the new inventory, thresholds and branding take effect without a restart.
 * Always ephemeral — the output describes the server's internals.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Inspect or reload the bot configuration.')
    .addSubcommand((sub) =>
      sub.setName('show').setDescription('Show the effective configuration (secrets hidden).'),
    )
    .addSubcommand((sub) =>
      sub.setName('reload').setDescription('Re-read .env and config.json without restarting.'),
    )
    .addSubcommand((sub) =>
      sub.setName('issues').setDescription('List problems found in the current config.'),
    ),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    switch (interaction.options.getSubcommand()) {
      case 'reload':
        return handleReload(interaction, context);
      case 'issues':
        return handleIssues(interaction);
      default:
        return handleShow(interaction);
    }
  },
};

export default command;

async function handleShow(interaction: ChatInputCommandInteraction): Promise<void> {
  const { bot, monitor, system, discord, access } = config;

  const embed = infoEmbed(
    `${bot.name} — configuration`,
    `Loaded from \`${config.configPath}\`\nEnvironment: \`${config.env}\` · log level \`${config.logLevel}\``,
  ).addFields(
    {
      name: 'Identity',
      value: [
        `Description: ${bot.description}`,
        `Presence: ${bot.activityType} ${bot.activityText} (${bot.presenceStatus})`,
        `Accent: #${bot.accentColor.toString(16).padStart(6, '0')}`,
        `Footer: ${bot.embedFooter || '—'}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Access',
      value: [
        `Admin users: ${access.adminUserIds.length}`,
        `Admin roles: ${access.adminRoleIds.length}`,
        `Alert channel: ${discord.alertChannelId ? `<#${discord.alertChannelId}>` : '— (not set)'}`,
        `Audit channel: ${discord.auditChannelId ? `<#${discord.auditChannelId}>` : '— (not set)'}`,
        `Command scope: ${discord.guildId ? `guild ${discord.guildId}` : 'global'}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Host access',
      value: [
        `systemd scope: \`${system.scope}\``,
        `sudo: ${system.useSudo ? 'enabled (`sudo -n`)' : 'disabled'}`,
        `Command timeout: ${system.commandTimeoutMs} ms`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Monitoring',
      value: [
        `${monitor.enabled ? 'Enabled' : 'Disabled'} · every ${monitor.intervalSeconds}s · cooldown ${monitor.alertCooldownMinutes}m`,
        `Checks: ${describeChecks()}`,
        `Thresholds: CPU ${monitor.thresholds.cpuPercent}% · MEM ${monitor.thresholds.memoryPercent}% · DISK ${monitor.thresholds.diskPercent}%`,
        `TLS warn at ${monitor.thresholds.certExpiryDays}d · slow at ${monitor.thresholds.responseMs || '—'} ms`,
        `History: ${monitor.historyHours}h retained · ${describeHistory()}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Inventory',
      value: [
        `Services: ${summarize(config.services.map((s) => s.name))}`,
        `Websites: ${summarize(config.websites.map((w) => w.name))}`,
        `Commands: ${summarize(config.commands.map((c) => c.name))}`,
        `Files: ${summarize(config.files.map((f) => f.name))}`,
      ].join('\n'),
      inline: false,
    },
  );

  const errors = configIssues.filter((issue) => issue.level === 'error').length;
  if (configIssues.length > 0) {
    embed.addFields({
      name: 'Issues',
      value: `${configIssues.length} total (${errors} error${errors === 1 ? '' : 's'}). Run \`/config issues\` for details.`,
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleReload(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const before = {
    services: config.services.length,
    websites: config.websites.length,
    commands: config.commands.length,
    files: config.files.length,
    intervalSeconds: config.monitor.intervalSeconds,
    enabled: config.monitor.enabled,
  };

  const result = reloadConfig();
  log.info({ user: interaction.user.tag, counts: result.counts }, 'configuration reloaded');
  context.audit({
    actor: interaction.user.tag,
    action: 'config.reload',
    target: result.configPath,
    detail:
      `${result.counts.services} services · ${result.counts.websites} sites · ` +
      `${result.counts.commands} commands · ${result.counts.files} files`,
  });

  // The monitor caches nothing but its interval, so restart it only when the
  // schedule itself changed.
  if (
    config.monitor.intervalSeconds !== before.intervalSeconds ||
    config.monitor.enabled !== before.enabled
  ) {
    context.alertScheduler.restart();
  }
  // Presence reads branding and the dynamic flag at apply time, but the
  // refresh interval is baked into its timer.
  context.presence.restart();

  const errors = result.issues.filter((issue) => issue.level === 'error');
  const embed = (errors.length > 0 ? warningEmbed : successEmbed)(
    errors.length > 0 ? 'Reloaded with problems' : 'Configuration reloaded',
    `Source: \`${result.configPath}\``,
  ).addFields(
    {
      name: 'Inventory',
      value: [
        `Services: ${before.services} → ${result.counts.services}`,
        `Websites: ${before.websites} → ${result.counts.websites}`,
        `Commands: ${before.commands} → ${result.counts.commands}`,
        `Files: ${before.files} → ${result.counts.files}`,
      ].join('\n'),
      inline: false,
    },
    {
      name: 'Needs a restart',
      value:
        'Discord token and log level are read once at startup. New or changed ' +
        'slash-command *definitions* also need `npm run deploy` — but services, ' +
        'websites, commands and files are picked up by autocomplete immediately.',
      inline: false,
    },
  );

  if (result.issues.length > 0) {
    embed.addFields({
      name: `Issues (${result.issues.length})`,
      value: fitEntries(formatIssues(result.issues), DiscordLimits.embedFieldValue),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleIssues(interaction: ChatInputCommandInteraction): Promise<void> {
  if (configIssues.length === 0) {
    await interaction.reply({
      embeds: [successEmbed('No configuration issues', 'Everything validated cleanly.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [
      warningEmbed(
        `${configIssues.length} configuration issue(s)`,
        fitEntries(formatIssues(configIssues), DiscordLimits.embedDescription),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

function formatIssues(issues: ConfigIssue[]): string[] {
  return issues.map(
    (issue) =>
      `${issue.level === 'error' ? '❌' : '⚠️'} \`${issue.scope}\` — ${issue.message}`,
  );
}

function describeChecks(): string {
  const enabled = Object.entries(config.monitor.checks)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return enabled.length > 0 ? enabled.join(', ') : 'none';
}

/** Render a name list compactly, without letting a long inventory blow the field. */
function summarize(names: string[]): string {
  if (names.length === 0) return '— none';
  const shown = names.slice(0, 8).join(', ');
  return names.length > 8
    ? `${names.length} (${shown}, +${names.length - 8} more)`
    : `${names.length} (${shown})`;
}

/** How much history has actually accumulated, for trust in /status trends. */
function describeHistory(): string {
  const { resources, sites } = metricsHistory.size;
  if (resources === 0 && sites === 0) return 'no samples yet';
  return `${resources} host + ${sites} site samples`;
}
