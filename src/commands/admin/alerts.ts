import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config/index.js';
import { infoEmbed, successEmbed, warningEmbed } from '../../lib/embeds.js';
import { formatDuration } from '../../lib/format.js';
import { childLogger } from '../../logger.js';
import { recordAudit } from '../../services/audit.js';
import type { BotContext, CommandModule } from '../../types.js';

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
        recordAudit(context.client, {
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
        recordAudit(context.client, {
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
      value: active
        .map(
          (alert) =>
            `🔴 **${alert.title}** — for ${formatDuration((Date.now() - alert.since) / 1000)}\n${alert.detail}`,
        )
        .join('\n\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
