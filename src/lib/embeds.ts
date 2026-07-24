import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

/** Shared color palette so every embed the bot sends looks consistent. */
export const Colors = {
  info: 0x5865f2, // Discord blurple
  success: 0x57f287, // green
  warning: 0xfee75c, // yellow
  danger: 0xed4245, // red
  neutral: 0x99aab5, // grey
} as const;

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(Colors.info, title, description);
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(Colors.success, `✅ ${title}`, description);
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(Colors.warning, `⚠️ ${title}`, description);
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return baseEmbed(Colors.danger, `❌ ${title}`, description);
}

function baseEmbed(color: number, title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (description) embed.setDescription(description);
  // Optional branding footer, configured via BOT_EMBED_FOOTER.
  if (config.bot.embedFooter) embed.setFooter({ text: config.bot.embedFooter });
  return embed;
}
