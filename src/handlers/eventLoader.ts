import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Client } from 'discord.js';
import { childLogger } from '../logger.js';
import type { BotContext, EventModule } from '../types.js';

const log = childLogger('eventLoader');
const __dirname = dirname(fileURLToPath(import.meta.url));
const eventsDir = resolve(__dirname, '../events');

/** Accept .ts (dev via tsx) and .js (compiled), but not declaration files. */
function isModuleFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  // Never auto-register a test file that happens to sit next to a module.
  if (name.includes('.test.')) return false;
  return name.endsWith('.ts') || name.endsWith('.js');
}

/** Discover and wire every event module to the client. */
export async function loadEvents(client: Client, context: BotContext): Promise<void> {
  const files = readdirSync(eventsDir).filter(isModuleFile);

  for (const file of files) {
    const mod = (await import(pathToFileURL(join(eventsDir, file)).href)) as {
      default?: EventModule;
    };
    const event = mod.default;

    if (!event?.name || typeof event.execute !== 'function') {
      log.warn({ file }, 'skipping invalid event module (missing name/execute)');
      continue;
    }

    const handler = (...args: unknown[]): void => {
      void event.execute(...args, context);
    };
    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
    log.debug({ event: event.name, once: Boolean(event.once) }, 'registered event');
  }

  log.info({ count: files.length }, 'events loaded');
}
