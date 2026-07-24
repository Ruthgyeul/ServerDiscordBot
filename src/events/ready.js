import { Events, ActivityType } from 'discord.js';
import { childLogger } from '../logger.js';

const log = childLogger('event:ready');

/**
 * Fired once when the client has connected and cached its guilds.
 * We start the alert scheduler here — not before login — because it needs a
 * live gateway connection to resolve and post to the alert channel.
 * @type {import('../handlers/eventLoader.js').EventModule}
 */
export default {
  name: Events.ClientReady,
  once: true,
  /**
   * @param {import('discord.js').Client} client
   * @param {object} context
   */
  execute(client, context) {
    log.info({ tag: client.user.tag, guilds: client.guilds.cache.size }, 'bot ready');

    client.user.setActivity('the server 🖥️', { type: ActivityType.Watching });

    context.alertScheduler.start();
  },
};
