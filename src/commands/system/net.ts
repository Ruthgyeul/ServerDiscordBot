import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getNetworkInterfaces, getListeningPorts } from '../../services/systemMonitor.js';
import { formatBytes } from '../../lib/format.js';
import type { CommandModule } from '../../types.js';

/**
 * `/net` — what the host looks like from the network side.
 *
 * `ports` answers the question that otherwise needs an SSH session and `ss
 * -tlnp`: what is actually exposed, and which process owns it. Admin-only,
 * because a listening-port list is a map of the attack surface.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('net')
    .setDescription('Inspect network interfaces and listening ports.')
    .addSubcommand((sub) =>
      sub
        .setName('interfaces')
        .setDescription('Show network interfaces, addresses and throughput.'),
    )
    .addSubcommand((sub) =>
      sub.setName('ports').setDescription('Show sockets in LISTEN state.'),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (interaction.options.getSubcommand() === 'ports') {
      return handlePorts(interaction);
    }
    return handleInterfaces(interaction);
  },
};

export default command;

async function handleInterfaces(interaction: ChatInputCommandInteraction): Promise<void> {
  const interfaces = await getNetworkInterfaces();

  if (interfaces.length === 0) {
    await interaction.editReply({
      embeds: [infoEmbed('No external interfaces', 'Only loopback is present.')],
    });
    return;
  }

  const embed = infoEmbed(`Network interfaces (${interfaces.length})`);
  for (const iface of interfaces) {
    embed.addFields({
      name: iface.name,
      value: [
        `IPv4: \`${iface.ip4 || '—'}\``,
        iface.ip6 ? `IPv6: \`${iface.ip6}\`` : null,
        `Now: ↓ ${formatBytes(iface.rxSec)}/s · ↑ ${formatBytes(iface.txSec)}/s`,
        `Total: ↓ ${formatBytes(iface.rxBytes)} · ↑ ${formatBytes(iface.txBytes)}`,
      ]
        .filter(Boolean)
        .join('\n'),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handlePorts(interaction: ChatInputCommandInteraction): Promise<void> {
  const ports = await getListeningPorts();

  if (ports.length === 0) {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          'No listening sockets found',
          'On most systems reading the full socket table needs elevated privileges — ' +
            'this may be a permission limit rather than an empty result.',
        ),
      ],
    });
    return;
  }

  const rows = ports.map((entry) => {
    const port = String(entry.port).padStart(6);
    const proto = entry.protocol.padEnd(5);
    const address = entry.address.slice(0, 20).padEnd(20);
    return `${port} ${proto} ${address} ${entry.process}`;
  });
  const header = `${'PORT'.padStart(6)} ${'PROTO'.padEnd(5)} ${'ADDRESS'.padEnd(20)} PROCESS`;

  await interaction.editReply({
    embeds: [
      infoEmbed(
        `Listening sockets (${ports.length})`,
        `\`\`\`\n${header}\n${rows.join('\n').slice(0, 3500)}\n\`\`\``,
      ),
    ],
  });
}
