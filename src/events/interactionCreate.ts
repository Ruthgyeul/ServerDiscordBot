import {
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Interaction,
  type InteractionReplyOptions,
} from 'discord.js';
import { childLogger } from '../logger.js';
import { hasPermission, Permission } from '../lib/permissions.js';
import { errorEmbed } from '../lib/embeds.js';
import type { BotContext, EventModule } from '../types.js';

const log = childLogger('event:interaction');

/**
 * Central slash-command dispatcher. Handles lookup, permission enforcement,
 * execution and uniform error reporting so individual commands stay focused
 * on their own logic.
 */
const event: EventModule = {
  name: Events.InteractionCreate,
  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    const context = args[1] as BotContext;

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
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : String(rawError);
      log.error(
        { command: interaction.commandName, err: message },
        'command execution failed',
      );
      await replyWithError(interaction, message);
    }
  },
};

export default event;

/**
 * Report an execution error back to the user, respecting whether the
 * interaction was already acknowledged/deferred.
 */
async function replyWithError(
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const embed = errorEmbed('Command failed', `\`\`\`${message}\`\`\``);
  const payload: InteractionReplyOptions = { embeds: [embed], flags: MessageFlags.Ephemeral };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (replyError) {
    const detail = replyError instanceof Error ? replyError.message : String(replyError);
    log.error({ err: detail }, 'failed to report error to user');
  }
}
