import { ActivityType, type Client, type PresenceStatusData } from 'discord.js';
import { config } from '../../config/index.js';
import { childLogger } from '../../logger.js';
import { getSnapshot } from '../host/systemMonitor.js';
import type { AlertScheduler } from './alertScheduler.js';

const log = childLogger('presence');

/**
 * The bot's presence, optionally reflecting the health of the host.
 *
 * Borrowed from the bot this one grew out of, which put the load level in its
 * activity text. It is a genuinely good idea: the member list becomes a status
 * light that costs nobody a command, and someone glancing at the sidebar sees
 * a problem without having gone looking for one.
 *
 * Static presence is the default. The dynamic mode reuses the numbers the
 * monitor already gathers, so enabling it adds one metrics read per refresh
 * and nothing else.
 */

/** Load thresholds for the health summary, as a share of CPU capacity. */
const BUSY_PERCENT = 60;
const STRAINED_PERCENT = 85;

export class PresenceManager {
  private readonly client: Client;
  private readonly scheduler: AlertScheduler;
  private timer: NodeJS.Timeout | null = null;

  constructor(client: Client, scheduler: AlertScheduler) {
    this.client = client;
    this.scheduler = scheduler;
  }

  /** Apply the presence once, then keep it fresh if dynamic mode is on. */
  start(): void {
    void this.apply();

    if (!config.bot.dynamicPresence) return;

    this.timer = setInterval(() => {
      void this.apply();
    }, config.bot.presenceRefreshSeconds * 1000);
    this.timer.unref?.();

    log.info(
      { refreshSeconds: config.bot.presenceRefreshSeconds },
      'dynamic presence enabled',
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-read presence config; used after `/config reload`. */
  restart(): void {
    this.stop();
    this.start();
  }

  private async apply(): Promise<void> {
    const user = this.client.user;
    if (!user) return;

    try {
      const suffix = config.bot.dynamicPresence ? await this.healthSummary() : '';
      user.setPresence({
        status: resolvePresenceStatus(config.bot.presenceStatus),
        activities: [
          {
            name: `${config.bot.activityText}${suffix}`,
            type: resolveActivityType(config.bot.activityType),
          },
        ],
      });
    } catch (rawError) {
      // Presence is decoration; never let it take down the process.
      const message = rawError instanceof Error ? rawError.message : String(rawError);
      log.warn({ err: message }, 'failed to update presence');
    }
  }

  /**
   * A short health phrase.
   *
   * Active alerts outrank load: a site being down matters more than the box
   * being briefly busy, and showing "idle" while something is broken would
   * make the indicator actively misleading.
   */
  private async healthSummary(): Promise<string> {
    const alerts = this.scheduler.getActiveAlerts();
    if (alerts.length > 0) {
      return ` · 🔴 ${alerts.length} alert${alerts.length === 1 ? '' : 's'}`;
    }

    const snapshot = await getSnapshot();
    const cpu = snapshot.cpuPercent;

    if (cpu >= STRAINED_PERCENT) return ` · 🔥 busy ${cpu.toFixed(0)}%`;
    if (cpu >= BUSY_PERCENT) return ` · ⚠️ load ${cpu.toFixed(0)}%`;
    return ' · ✅ healthy';
  }
}

/**
 * Map the human-friendly BOT_ACTIVITY_TYPE string to discord.js's ActivityType
 * enum, falling back to "Watching" for anything unrecognized.
 */
export function resolveActivityType(value: string): ActivityType {
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
export function resolvePresenceStatus(value: string): PresenceStatusData {
  const allowed: PresenceStatusData[] = ['online', 'idle', 'dnd', 'invisible'];
  const key = value.toLowerCase() as PresenceStatusData;
  return allowed.includes(key) ? key : 'online';
}
