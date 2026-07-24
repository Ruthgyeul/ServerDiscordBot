import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { infoEmbed } from '../../lib/embeds.js';
import { getTopProcesses } from '../../services/systemMonitor.js';
import { formatPercent } from '../../lib/format.js';
import type { CommandModule } from '../../types.js';

/**
 * `/top` — the heaviest processes on the host.
 *
 * `/status` says the box is busy; this says *what* is making it busy. Kept
 * admin-only because a process list is a fairly detailed map of what runs on
 * the server.
 */
const command: CommandModule = {
  permission: Permission.ADMIN,
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Show the processes using the most CPU or memory.')
    .addStringOption((opt) =>
      opt
        .setName('sort')
        .setDescription('What to sort by (default CPU).')
        .addChoices({ name: 'CPU', value: 'cpu' }, { name: 'Memory', value: 'memory' }),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('count')
        .setDescription('How many processes to show (1–20, default 10).')
        .setMinValue(1)
        .setMaxValue(20),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sortBy = interaction.options.getString('sort') === 'memory' ? 'memory' : 'cpu';
    const count = interaction.options.getInteger('count') ?? 10;
    const processes = await getTopProcesses(sortBy, count);

    if (processes.length === 0) {
      await interaction.editReply({
        embeds: [infoEmbed('No process data', 'The host returned an empty process list.')],
      });
      return;
    }

    // A fixed-width code block keeps the columns aligned on mobile too.
    const rows = processes.map((proc) => {
      const pid = String(proc.pid).padStart(7);
      const cpu = formatPercent(proc.cpuPercent).padStart(6);
      const mem = formatPercent(proc.memPercent).padStart(6);
      const user = proc.user.slice(0, 10).padEnd(10);
      return `${pid} ${cpu} ${mem}  ${user} ${proc.name}`;
    });
    const header = `${'PID'.padStart(7)} ${'CPU'.padStart(6)} ${'MEM'.padStart(6)}  ${'USER'.padEnd(10)} COMMAND`;

    await interaction.editReply({
      embeds: [
        infoEmbed(
          `Top ${processes.length} processes by ${sortBy === 'cpu' ? 'CPU' : 'memory'}`,
          `\`\`\`\n${header}\n${rows.join('\n')}\n\`\`\``,
        ),
      ],
    });
  },
};

export default command;
