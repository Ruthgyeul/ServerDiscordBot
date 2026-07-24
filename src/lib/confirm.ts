import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { warningEmbed, infoEmbed } from './embeds.js';

/**
 * A two-step confirmation for actions that are hard to take back.
 *
 * Stopping the reverse proxy is one mistyped autocomplete entry away from
 * taking every site offline, so the destructive paths ask first. The prompt is
 * ephemeral and only the user who invoked the command can answer it — a second
 * admin cannot confirm someone else's pending action.
 */

/** How long the buttons stay live before the action is abandoned. */
const TIMEOUT_MS = 30_000;

export interface ConfirmOptions {
  title: string;
  description: string;
  /** Label for the destructive button, e.g. "Stop nginx". */
  confirmLabel: string;
}

/**
 * Ask for confirmation and resolve to the user's answer.
 *
 * Acknowledges the interaction itself, so callers must not have replied or
 * deferred beforehand, and should use `followUp` afterwards.
 */
export async function confirmAction(
  interaction: ChatInputCommandInteraction,
  { title, description, confirmLabel }: ConfirmOptions,
): Promise<boolean> {
  const confirmId = `confirm:${interaction.id}`;
  const cancelId = `cancel:${interaction.id}`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  const prompt = await interaction.reply({
    embeds: [
      warningEmbed(
        title,
        `${description}\n\nThis cannot be undone from Discord. Confirm within 30 seconds.`,
      ),
    ],
    components: [row],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });

  const message = prompt.resource?.message;
  if (!message) return false;

  try {
    const answer: ButtonInteraction = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: TIMEOUT_MS,
      // Only the invoking user may answer their own prompt.
      filter: (button) => button.user.id === interaction.user.id,
    });

    const confirmed = answer.customId === confirmId;
    await answer.update({
      embeds: [
        confirmed
          ? infoEmbed('Confirmed', 'Working…')
          : infoEmbed('Cancelled', 'Nothing was changed.'),
      ],
      components: [],
    });
    return confirmed;
  } catch {
    // awaitMessageComponent rejects on timeout — treat silence as "no".
    await interaction
      .editReply({
        embeds: [infoEmbed('Timed out', 'No confirmation received; nothing was changed.')],
        components: [],
      })
      .catch(() => undefined);
    return false;
  }
}
