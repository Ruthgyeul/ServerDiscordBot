import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config, findWebsite } from '../../config.js';
import { checkAllSites, checkSite } from '../../services/webMonitor.js';
import { infoEmbed } from '../../lib/embeds.js';
import type { CommandModule, WebsiteConfig } from '../../types.js';

/**
 * `/sites` — check the HTTP health of the websites hosted on this server.
 * Read-only; available to everyone by default.
 */
const command: CommandModule = {
  permission: Permission.EVERYONE,
  data: new SlashCommandBuilder()
    .setName('sites')
    .setDescription('Check the health of the hosted websites.')
    .addStringOption((opt) =>
      opt
        .setName('name')
        .setDescription('Check a single site (defaults to all).')
        .addChoices(
          ...config.websites.slice(0, 25).map((w) => ({ name: w.label, value: w.name })),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();

    if (config.websites.length === 0) {
      await interaction.editReply({
        embeds: [infoEmbed('No websites configured', 'Add sites in `config/config.json`.')],
      });
      return;
    }

    const name = interaction.options.getString('name');
    const results = name ? [await checkSite(requireSite(name))] : await checkAllSites();

    const lines = results.map((r) => {
      const icon = r.up ? '🟢' : '🔴';
      const status = r.status ? `HTTP ${r.status}` : 'no response';
      const detail = r.up ? `${status} · ${r.responseMs} ms` : `${status} · ${r.error}`;
      return `${icon} **${r.site.label}** — ${detail}\n${r.site.url}`;
    });

    const allUp = results.every((r) => r.up);
    const embed = infoEmbed(
      allUp ? '🟢 All sites healthy' : '🔴 Some sites are down',
      lines.join('\n\n'),
    );

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;

/** Resolve a site name to its config entry or throw a clear error. */
function requireSite(name: string): WebsiteConfig {
  const site = findWebsite(name);
  if (!site) throw new Error(`Unknown website "${name}".`);
  return site;
}
