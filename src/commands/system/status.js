import { SlashCommandBuilder } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getSnapshot, getHostInfo } from '../../services/systemMonitor.js';
import { formatBytes, formatDuration, progressBar } from '../../lib/format.js';

/**
 * Show an at-a-glance dashboard of host health: CPU, memory, disks and uptime.
 * Read-only, so it is available to everyone by default.
 * @type {import('../../handlers/commandLoader.js').Command}
 */
export default {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show host CPU, memory, disk and uptime at a glance.'),

  async execute(interaction) {
    await interaction.deferReply();

    const [snap, host] = await Promise.all([getSnapshot(), getHostInfo()]);

    const embed = infoEmbed(`🖥️ ${host.hostname}`)
      .setDescription(`${host.distro} · kernel ${host.kernel}`)
      .addFields(
        {
          name: 'CPU',
          value: `${progressBar(snap.cpuPercent)}\nLoad avg (1m): ${snap.loadAvg1.toFixed(2)}`,
          inline: false,
        },
        {
          name: 'Memory',
          value: `${progressBar(snap.memPercent)}\n${formatBytes(snap.memUsed)} / ${formatBytes(snap.memTotal)}`,
          inline: false,
        },
        {
          name: 'Uptime',
          value: formatDuration(snap.uptime),
          inline: true,
        },
      );

    for (const disk of snap.disks.slice(0, 6)) {
      embed.addFields({
        name: `Disk ${disk.mount}`,
        value: `${progressBar(disk.usePercent)}\n${formatBytes(disk.used)} / ${formatBytes(disk.size)}`,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
