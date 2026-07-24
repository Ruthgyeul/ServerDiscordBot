import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import {
  getSnapshot,
  getHostInfo,
  getRebootStatus,
} from '../../services/host/systemMonitor.js';
import { formatBytes, formatDuration, progressBar } from '../../lib/format.js';
import { metricsHistory, formatTrend } from '../../services/monitor/metricsHistory.js';
import { fitEntries } from '../../lib/limits.js';
import { config } from '../../config/index.js';
import type { CommandModule } from '../../types/index.js';

/**
 * Show an at-a-glance dashboard of host health: CPU, memory, disks and uptime.
 * Read-only, so it is available to everyone by default.
 */
const command: CommandModule = {
  cooldownSeconds: 5,
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show host CPU, memory, disk and uptime at a glance.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    const [snap, host, reboot] = await Promise.all([
      getSnapshot(),
      getHostInfo(),
      getRebootStatus(),
    ]);

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

    // Temperature only exists on hardware that exposes a sensor; a VM showing
    // an empty field would read as a fault rather than as "not applicable".
    if (snap.cpuTempC !== null) {
      const limit = config.monitor.thresholds.cpuTempCelsius;
      const hot = limit > 0 && snap.cpuTempC >= limit;
      embed.addFields({
        name: 'CPU temp',
        value: `${hot ? '🌡️ ' : ''}${snap.cpuTempC.toFixed(1)} °C`,
        inline: true,
      });
    }

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

    if (reboot.required) {
      embed.addFields({
        name: '⚠️ Reboot required',
        value:
          reboot.packages.length > 0
            ? `Pending since a package update: ${fitEntries(reboot.packages, 900, ', ')}`
            : 'A package update has requested a reboot.',
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
