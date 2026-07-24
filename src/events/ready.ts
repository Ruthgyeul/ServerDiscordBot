import { ActivityType, Events, type Client, type PresenceStatusData } from 'discord.js';
import { childLogger } from '../logger.js';
import { config } from '../config/index.js';
import type { BotContext, EventModule } from '../types.js';

const log = childLogger('event:ready');

/**
 * Map the human-friendly BOT_ACTIVITY_TYPE string to discord.js's ActivityType
 * enum, falling back to "Watching" for anything unrecognized.
 */
function resolveActivityType(value: string): ActivityType {
  const map: Record<string, ActivityType> = {
    playing: ActivityType.Playing,
    watching: ActivityType.Watching,
    listening: ActivityType.Listening,
    competing: ActivityType.Competing,
    custom: ActivityType.Custom,
  };
  return map[value.toLowerCase()] ?? ActivityType.Watching;
}

/** Map BOT_PRESENCE_STATUS to a valid presence status, defaulting to "online". */
function resolvePresenceStatus(value: string): PresenceStatusData {
  const allowed: PresenceStatusData[] = ['online', 'idle', 'dnd', 'invisible'];
  const key = value.toLowerCase() as PresenceStatusData;
  return allowed.includes(key) ? key : 'online';
}

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

    // Presence (activity/status) is driven entirely by .env config.
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

export default event;
