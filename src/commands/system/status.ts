import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getSnapshot, getHostInfo } from '../../services/systemMonitor.js';
import { formatBytes, formatDuration, progressBar } from '../../lib/format.js';
import { metricsHistory, formatTrend } from '../../services/metricsHistory.js';
import type { CommandModule } from '../../types.js';

/**
 * Show an at-a-glance dashboard of host health: CPU, memory, disks and uptime.
 * Read-only, so it is available to everyone by default.
 */
const command: CommandModule = {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show host CPU, memory, disk and uptime at a glance.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const [snap, host] = await Promise.all([getSnapshot(), getHostInfo()]);

    const cores = snap.cpuCores > 0 ? ` · ${snap.cpuCores} cores` : '';
    const embed = infoEmbed(`🖥️ ${host.hostname}`)
      .setDescription(`${host.distro} · kernel ${host.kernel}`)
      .addFields(
        {
          name: 'CPU',
          value:
            `${progressBar(snap.cpuPercent)}${formatTrend(metricsHistory.getResourceTrend('cpuPercent'))}\n` +
            `Load avg (1m): ${snap.loadAvg1.toFixed(2)}${cores}`,
          inline: false,
        },
        {
          name: 'Memory',
          value:
            `${progressBar(snap.memPercent)}${formatTrend(metricsHistory.getResourceTrend('memPercent'))}\n` +
            `${formatBytes(snap.memUsed)} / ${formatBytes(snap.memTotal)}`,
          inline: false,
        },
        {
          name: 'Uptime',
          value: formatDuration(snap.uptime),
          inline: true,
        },
      );

    // Swap is only worth the space when the host actually has some.
    if (snap.swapTotal > 0) {
      embed.addFields({
        name: 'Swap',
        value: `${progressBar(snap.swapPercent)}\n${formatBytes(snap.swapUsed)} / ${formatBytes(snap.swapTotal)}`,
        inline: false,
      });
    }

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

export default command;
