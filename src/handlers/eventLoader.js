import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { childLogger } from '../logger.js';

const log = childLogger('eventLoader');
const __dirname = dirname(fileURLToPath(import.meta.url));
const eventsDir = resolve(__dirname, '../events');

/**
 * An event module contract. Every file under src/events/ must export:
 *   - `name`: the discord.js event name (e.g. Events.ClientReady).
 *   - `once` (optional): true to register with client.once().
 *   - `execute(...args, context)`: the handler; `context` is appended last.
 * @typedef {object} EventModule
 * @property {string} name
 * @property {boolean} [once]
 * @property {(...args: any[]) => void | Promise<void>} execute
 */

/**
 * Discover and wire every event module to the client.
 * @param {import('discord.js').Client} client
 * @param {object} context - Shared context injected into every handler.
 */
export async function loadEvents(client, context) {
  const files = readdirSync(eventsDir).filter((f) => f.endsWith('.js'));

  for (const file of files) {
    const mod = await import(pathToFileURL(join(eventsDir, file)).href);
    const event = mod.default ?? mod;

    if (!event?.name || typeof event.execute !== 'function') {
      log.warn({ file }, 'skipping invalid event module (missing name/execute)');
      continue;
    }

    const handler = (...args) => event.execute(...args, context);
    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
    log.debug({ event: event.name, once: Boolean(event.once) }, 'registered event');
  }

  log.info({ count: files.length }, 'events loaded');
}
