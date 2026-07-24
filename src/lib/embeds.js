import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';

/**
 * Shared color palette so every embed the bot sends looks consistent.
 * @readonly
 */
export const Colors = Object.freeze({
  info: 0x5865f2, // Discord blurple
  success: 0x57f287, // green
  warning: 0xfee75c, // yellow
  danger: 0xed4245, // red
  neutral: 0x99aab5, // grey
});

/**
 * @param {string} title
 * @param {string} [description]
 */
export function infoEmbed(title, description) {
  return baseEmbed(Colors.info, title, description);
}

export function successEmbed(title, description) {
  return baseEmbed(Colors.success, `✅ ${title}`, description);
}

export function warningEmbed(title, description) {
  return baseEmbed(Colors.warning, `⚠️ ${title}`, description);
}

export function errorEmbed(title, description) {
  return baseEmbed(Colors.danger, `❌ ${title}`, description);
}

/**
 * @param {number} color
 * @param {string} title
 * @param {string} [description]
 */
function baseEmbed(color, title, description) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
  if (description) embed.setDescription(description);
  // Optional branding footer, configured via BOT_EMBED_FOOTER.
  if (config.bot.embedFooter) embed.setFooter({ text: config.bot.embedFooter });
  return embed;
}
