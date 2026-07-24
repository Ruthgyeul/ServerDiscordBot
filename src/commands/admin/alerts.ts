import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config/index.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../lib/embeds.js';
import { formatDuration } from '../../lib/format.js';
import { DiscordLimits, fitEntries } from '../../lib/limits.js';
import { childLogger } from '../../logger.js';
import type { BotContext, CommandModule } from '../../types/index.js';

const log = childLogger('command:alerts');

/**
 * `/alerts` — operate the background monitor from Discord.
 *
 * The monitor is otherwise invisible until something breaks, which makes it
 * hard to trust. These subcommands make it inspectable (`state`), verifiable
 * (`test`, `check`) and controllable during planned work (`mute`).
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Inspect and control the background health monitor.')
    .addSubcommand((sub) =>
      sub.setName('state').setDescription('Show monitor state and any active alerts.'),
    )
    .addSubcommand((sub) =>
      sub.setName('check').setDescription('Run a monitoring pass right now.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Recent alerts that fired or recovered.')
        .addIntegerOption((opt) =>
          opt
            .setName('count')
            .setDescription('How many events to show (1–25, default 15).')
            .setMinValue(1)
            .setMaxValue(25),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Post a test alert to verify the alert channel works.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('mute')
        .setDescription('Suppress alerts for a while (e.g. during maintenance).')
        .addIntegerOption((opt) =>
          opt
            .setName('minutes')
            .setDescription('How long to stay quiet (1–1440).')
            .setMinValue(1)
            .setMaxValue(1440)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('unmute').setDescription('Resume alerting now.')),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    const scheduler = context.alertScheduler;

    switch (interaction.options.getSubcommand()) {
      case 'check': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await scheduler.tick();
        const active = scheduler.getActiveAlerts();
        await interaction.editReply({
          embeds: [
            successEmbed(
              'Monitoring pass complete',
              active.length === 0
                ? 'Everything is healthy.'
                : `${active.length} condition(s) currently unhealthy — see \`/alerts state\`.`,
            ),
          ],
        });
        return;
      }

      case 'test': {
        if (!config.discord.alertChannelId) {
          await interaction.reply({
            embeds: [
              warningEmbed(
                'No alert channel configured',
                'Set `ALERT_CHANNEL_ID` in `.env`, then run `/config reload`.',
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        scheduler.sendDirect(
          infoEmbed(
            'Test alert',
            `Triggered by ${interaction.user.tag}. If you can read this, alerting works.`,
          ),
        );
        log.info({ user: interaction.user.tag }, 'test alert sent');
        await interaction.reply({
          embeds: [
            successEmbed('Test alert sent', `Posted to <#${config.discord.alertChannelId}>.`),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'mute': {
        const minutes = interaction.options.getInteger('minutes', true);
        const until = scheduler.mute(minutes);
        log.info({ user: interaction.user.tag, minutes }, 'alerts muted');
        context.audit({
          actor: interaction.user.tag,
          action: 'alerts.mute',
          target: `${minutes} minutes`,
        });
        await interaction.reply({
          embeds: [
            successEmbed(
              `Alerts muted for ${minutes} minute(s)`,
              `Alerting resumes <t:${Math.floor(until.getTime() / 1000)}:R>. ` +
                'Monitoring keeps running — only the messages are suppressed.',
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'unmute': {
        scheduler.unmute();
        context.audit({
          actor: interaction.user.tag,
          action: 'alerts.unmute',
          target: 'monitor',
        });
        await interaction.reply({
          embeds: [successEmbed('Alerts resumed', 'The monitor will post again.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'history':
        return handleHistory(interaction, context);

      default:
        return handleState(interaction, context);
    }
  },
};

export default command;

async function handleState(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
): Promise<void> {
  const scheduler = context.alertScheduler;
  const active = scheduler.getActiveAlerts();
  const muteExpiry = scheduler.muteExpiry;

  const embed = infoEmbed(
    active.length === 0
      ? '🟢 All monitored conditions healthy'
      : `🔴 ${active.length} active alert(s)`,
  ).addFields({
    name: 'Monitor',
    value: [
      `Loop: ${scheduler.running ? `running every ${config.monitor.intervalSeconds}s` : 'stopped'}`,
      `Cooldown: ${config.monitor.alertCooldownMinutes} min`,
      `Channel: ${config.discord.alertChannelId ? `<#${config.discord.alertChannelId}>` : '— not set'}`,
      muteExpiry
        ? `Muted until <t:${Math.floor(muteExpiry.getTime() / 1000)}:t>`
        : 'Not muted',
    ].join('\n'),
    inline: false,
  });

  if (active.length > 0) {
    embed.addFields({
      name: 'Active',
      value: fitEntries(
        active.map(
          (alert) =>
            `🔴 **${alert.title}** — for ${formatDuration((Date.now() - alert.since) / 1000)}\n${alert.detail}`,
        ),
        DiscordLimits.embedFieldValue,
        '\n\n',
      ),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Show recent transitions. This is the view that catches the problem nobody
 * saw: a site that fails and recovers every few hours looks perfectly healthy
 * in `/alerts state` at any single moment.
 */
async function handleHistory(
  interaction: ChatInputCommandInteraction,
  context: BotContext,
): Promise<void> {
  const count = interaction.options.getInteger('count') ?? 15;
  const events = context.alertScheduler.getRecentEvents(count);

  if (events.length === 0) {
    await interaction.reply({
      embeds: [
        infoEmbed(
          'No alert history yet',
          'Nothing has fired or recovered since the bot started. History is ' +
            'kept in memory, so a restart clears it.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const lines = events.map((event) => {
    const icon = event.kind === 'fired' ? '🔴' : '🟢';
    const when = `<t:${Math.floor(event.at / 1000)}:R>`;
    return `${icon} **${event.title}** — ${event.kind} ${when}`;
  });

  await interaction.reply({
    embeds: [
      infoEmbed(
        `Recent alert activity (${events.length})`,
        fitEntries(lines, DiscordLimits.embedDescription),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
