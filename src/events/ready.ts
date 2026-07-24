import { Events, type Client } from 'discord.js';
import { childLogger } from '../logger.js';
import { config } from '../config/index.js';
import { infoEmbed } from '../lib/embeds.js';
import type { BotContext, EventModule } from '../types/index.js';

const log = childLogger('event:ready');

/**
 * Fired once when the client has connected and cached its guilds.
 * We start the alert scheduler here — not before login — because it needs a
 * live gateway connection to resolve and post to the alert channel.
 */
const event: EventModule = {
  name: Events.ClientReady,
  once: true,
  execute(...args: unknown[]): void {
    const client = args[0] as Client<true>;
    const context = args[1] as BotContext;

    log.info({ tag: client.user.tag, guilds: client.guilds.cache.size }, 'bot ready');

    // Presence is driven entirely by .env config, and — when BOT_DYNAMIC_PRESENCE
    // is on — kept in step with the host's health.
    context.presence.start();

    context.alertScheduler.start();

    // A restart is the most common cause of "why did the bot stop answering?".
    // Announcing it turns that into a visible, timestamped event instead of a
    // gap someone has to notice and investigate.
    context.alertScheduler.sendDirect(
      infoEmbed(
        `${config.bot.name} is online`,
        [
          `Commands: ${context.commands.size}`,
          `Monitoring: ${config.monitor.enabled ? `every ${config.monitor.intervalSeconds}s` : 'disabled'}`,
          `Inventory: ${config.services.length} services · ${config.websites.length} sites · ` +
            `${config.commands.length} commands · ${config.files.length} files`,
        ].join('\n'),
      ),
    );
  },
};

export default event;
