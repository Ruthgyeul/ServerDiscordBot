import { Events, MessageFlags } from 'discord.js';
import { childLogger } from '../logger.js';
import { hasPermission, Permission } from '../lib/permissions.js';
import { errorEmbed } from '../lib/embeds.js';

const log = childLogger('event:interaction');

/**
 * Central slash-command dispatcher. Handles lookup, permission enforcement,
 * execution and uniform error reporting so individual commands stay focused
 * on their own logic.
 * @type {import('../handlers/eventLoader.js').EventModule}
 */
export default {
  name: Events.InteractionCreate,
  /**
   * @param {import('discord.js').Interaction} interaction
   * @param {object} context
   */
  async execute(interaction, context) {
    if (!interaction.isChatInputCommand()) return;

    const command = context.commands.get(interaction.commandName);
    if (!command) {
      log.warn({ command: interaction.commandName }, 'received unknown command');
      return;
    }

    // Default to admin-only for anything that did not opt into being public.
    const required = command.permission ?? Permission.ADMIN;
    if (!hasPermission(interaction, required)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            'Permission denied',
            'This command is restricted to server administrators.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      log.info(
        { command: interaction.commandName, user: interaction.user.tag },
        'permission denied',
      );
      return;
    }

    try {
      await command.execute(interaction, context);
    } catch (error) {
      log.error(
        { command: interaction.commandName, err: error.message },
        'command execution failed',
      );
      await replyWithError(interaction, error);
    }
  },
};

/**
 * Report an execution error back to the user, respecting whether the
 * interaction was already acknowledged/deferred.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Error} error
 */
async function replyWithError(interaction, error) {
  const embed = errorEmbed('Command failed', `\`\`\`${error.message}\`\`\``);
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (replyError) {
    log.error({ err: replyError.message }, 'failed to report error to user');
  }
}
