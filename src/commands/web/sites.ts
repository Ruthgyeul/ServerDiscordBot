import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Permission } from '../../lib/permissions.js';
import { config, findWebsite } from '../../config/index.js';
import { checkAllSites, checkSite, type WebResult } from '../../services/webMonitor.js';
import { infoEmbed } from '../../lib/embeds.js';
import { respondWithEntries } from '../../lib/autocomplete.js';
import { metricsHistory } from '../../services/metricsHistory.js';
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
        .setAutocomplete(true),
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

    const allUp = results.every((r) => r.up);
    const embed = infoEmbed(
      allUp ? '🟢 All sites healthy' : '🔴 Some sites are down',
      results.map(describeSite).join('\n\n'),
    );

    await interaction.editReply({ embeds: [embed] });
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    await respondWithEntries(interaction, config.websites);
  },
};

export default command;

/** Render one site's result: reachability first, then latency and certificate. */
function describeSite(result: WebResult): string {
  const icon = result.up ? (result.slow ? '🟡' : '🟢') : '🔴';
  const status = result.status ? `HTTP ${result.status}` : 'no response';
  const detail = result.up
    ? `${status} · ${result.responseMs} ms${result.slow ? ' (slow)' : ''}`
    : `${status} · ${result.error}`;

  const lines = [`${icon} **${result.site.label}** — ${detail}`, result.site.url];

  // Uptime only exists once the monitor has been running a while; saying
  // nothing is better than implying 100% from a single sample.
  const availability = metricsHistory.getAvailability(result.site.name);
  if (availability) {
    lines.push(
      `Uptime: ${availability.uptimePercent.toFixed(2)}% over ${availability.spanMinutes}m ` +
        `· avg ${Math.round(availability.averageMs)} ms`,
    );
  }

  const cert = result.cert;
  if (cert) {
    const warn = cert.daysRemaining <= config.monitor.thresholds.certExpiryDays ? '⚠️ ' : '';
    const invalid = cert.authorized ? '' : ` · ⚠️ ${cert.authError ?? 'untrusted chain'}`;
    lines.push(
      `${warn}TLS: ${cert.daysRemaining}d left (${cert.validTo.toISOString().slice(0, 10)})${invalid}`,
    );
  } else if (result.certError && result.up) {
    lines.push(`TLS: ${result.certError}`);
  }

  return lines.join('\n');
}

/** Resolve a site name to its config entry or throw a clear error. */
function requireSite(name: string): WebsiteConfig {
  const site = findWebsite(name);
  if (!site) throw new Error(`Unknown website "${name}".`);
  return site;
}
