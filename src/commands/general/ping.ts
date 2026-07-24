import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import type { CommandModule } from '../../types.js';

/** A trivial liveness/latency check. Public so anyone can confirm the bot is up. */
const command: CommandModule = {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot is alive and its latency.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sent = (await interaction.reply({
      embeds: [infoEmbed('Pong! 🏓', 'Measuring latency…')],
      fetchReply: true,
    })) as Message;

    const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
    const heartbeat = Math.round(interaction.client.ws.ping);

    await interaction.editReply({
      embeds: [
        infoEmbed(
          'Pong! 🏓',
          `**Round-trip:** ${roundTrip} ms\n**WebSocket:** ${heartbeat} ms`,
        ),
      ],
    });
  },
};

export default command;
