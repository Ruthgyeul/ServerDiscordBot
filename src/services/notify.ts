import type { Client } from 'discord.js';
import { config } from '../config/index.js';
import { childLogger } from '../logger.js';

const log = childLogger('notify');

/**
 * Last-resort notification: a direct message to the operator.
 *
 * Taken from the bot this one grew out of, and it earns its place. Every other
 * route the bot has for saying "something is wrong" runs through the alert
 * channel — which is useless precisely when the failure is the alert channel
 * being deleted, the bot losing permission to post in it, or the process
 * crashing before the channel cache is populated. A DM does not depend on any
 * of that.
 *
 * Reserved for failures a human must know about. Routine alerts belong in the
 * channel, where they can be read by everyone and muted during maintenance.
 */

export type NotifyLevel = 'info' | 'warn' | 'critical';

const PREFIX: Record<NotifyLevel, string> = {
  info: 'ℹ️',
  warn: '⚠️',
  critical: '🚨',
};

/**
 * Suppress repeats of the same message for this long.
 *
 * A crash loop restarts the process every few seconds, and a DM per restart
 * would bury the operator in exactly the situation where they need to read
 * one clear message.
 */
const DEDUPE_MS = 5 * 60 * 1000;

/** message -> last time it was sent. */
const lastSent = new Map<string, number>();

/**
 * Cap the dedupe map. Keys are whole messages including stack traces, so a
 * crash loop that fails differently each time would otherwise grow it without
 * bound — in a process that is already unhealthy.
 */
const MAX_TRACKED = 50;

/**
 * DM the configured owner. Never throws and never blocks a shutdown path.
 *
 * @returns whether a message was actually dispatched.
 */
export async function notifyOwner(
  client: Client,
  message: string,
  level: NotifyLevel = 'critical',
): Promise<boolean> {
  const ownerId = config.discord.ownerUserId;
  if (!ownerId) return false;

  const now = Date.now();
  const previous = lastSent.get(message);
  if (previous !== undefined && now - previous < DEDUPE_MS) {
    log.debug('suppressed a repeated owner notification');
    return false;
  }
  if (lastSent.size >= MAX_TRACKED) {
    for (const [key, at] of lastSent) {
      if (now - at >= DEDUPE_MS) lastSent.delete(key);
    }
    // Still full of live entries: drop the oldest to make room.
    if (lastSent.size >= MAX_TRACKED) {
      const oldest = [...lastSent.entries()].sort((a, b) => a[1] - b[1])[0];
      if (oldest) lastSent.delete(oldest[0]);
    }
  }
  lastSent.set(message, now);

  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send(
      `${PREFIX[level]} **${config.bot.name} — ${level.toUpperCase()}**\n` +
        `\`\`\`\n${message.slice(0, 1800)}\n\`\`\``,
    );
    return true;
  } catch (rawError) {
    // The owner may have DMs closed, or share no guild with the bot. Log it
    // and move on — this is the fallback path, so there is nowhere else to go.
    const detail = rawError instanceof Error ? rawError.message : String(rawError);
    log.warn({ err: detail }, 'failed to DM the owner');
    return false;
  }
}
