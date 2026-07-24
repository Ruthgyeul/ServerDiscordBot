import { Events, ActivityType, PresenceUpdateStatus } from 'discord.js';
import { childLogger } from '../logger.js';
import { config } from '../config.js';

const log = childLogger('event:ready');

/**
 * Map the human-friendly BOT_ACTIVITY_TYPE string to discord.js's ActivityType
 * enum, falling back to "Watching" for anything unrecognized.
 * @param {string} value
 */
function resolveActivityType(value) {
  const key = String(value).toLowerCase();
  const map = {
    playing: ActivityType.Playing,
    watching: ActivityType.Watching,
    listening: ActivityType.Listening,
    competing: ActivityType.Competing,
    custom: ActivityType.Custom,
  };
  return map[key] ?? ActivityType.Watching;
}

/**
 * Map BOT_PRESENCE_STATUS to a valid presence status, defaulting to "online".
 * @param {string} value
 */
function resolvePresenceStatus(value) {
  const allowed = ['online', 'idle', 'dnd', 'invisible'];
  const key = String(value).toLowerCase();
  return allowed.includes(key) ? key : PresenceUpdateStatus.Online;
}

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

    // Presence (name/activity/status) is driven entirely by .env config.
    client.user.setPresence({
      status: resolvePresenceStatus(config.bot.presenceStatus),
      activities: [
        {
          name: config.bot.activityText,
          type: resolveActivityType(config.bot.activityType),
        },
      ],
    });

    context.alertScheduler.start();
  },
};
