import { SlashCommandBuilder } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';

/**
 * A trivial liveness/latency check. Public so anyone can confirm the bot is up.
 * @type {import('../../handlers/commandLoader.js').Command}
 */
export default {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check whether the bot is alive and its latency.'),

  async execute(interaction) {
    const sent = await interaction.reply({
      embeds: [infoEmbed('Pong! 🏓', 'Measuring latency…')],
      fetchReply: true,
    });

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
