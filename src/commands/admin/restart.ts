import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config } from '../../config/index.js';
import { confirmAction } from '../../lib/confirm.js';
import { successEmbed } from '../../lib/embeds.js';
import { childLogger } from '../../logger.js';
import type { BotContext, CommandModule } from '../../types/index.js';

const log = childLogger('command:restart');

/** Give Discord a moment to flush the reply before the process goes away. */
const EXIT_DELAY_MS = 1500;

/**
 * `/restart` — restart the bot itself.
 *
 * The obvious approach, `/service restart` against the bot's own unit, does
 * not work: systemd kills the process mid-interaction and the reply is never
 * sent, so the operator sees a failed command and cannot tell whether it
 * worked. Exiting cleanly instead lets the supervisor's `Restart=always` do
 * the work, and the reply lands before the process leaves.
 *
 * This is why it requires a supervisor. Without one, the bot simply stops —
 * so the confirmation says so rather than assuming.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart the bot process (requires a supervisor to bring it back).'),

  async execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> {
    const confirmed = await confirmAction(interaction, {
      title: `Restart ${config.bot.name}?`,
      description:
        'The bot exits and relies on its service supervisor to start it again. ' +
        'Monitoring stops until it is back, and in-memory history — trends, ' +
        'uptime samples, alert history — is cleared.',
      confirmLabel: 'Restart now',
    });
    if (!confirmed) return;

    context.audit({
      actor: interaction.user.tag,
      action: 'bot.restart',
      target: config.bot.name,
    });
    log.warn({ user: interaction.user.tag }, 'restart requested from Discord');

    await interaction.editReply({
      embeds: [
        successEmbed(
          'Restarting',
          'Exiting now. If the supervisor is configured with `Restart=always`, ' +
            'the bot will be back within a few seconds and will post its startup notice.',
        ),
      ],
      components: [],
    });

    // Shut down through the normal signal path so the graceful-shutdown
    // handler runs: it posts the shutdown notice and destroys the client.
    setTimeout(() => {
      process.kill(process.pid, 'SIGTERM');
    }, EXIT_DELAY_MS).unref?.();
  },
};

export default command;
