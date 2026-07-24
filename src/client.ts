import { Client, GatewayIntentBits } from 'discord.js';
import { loadCommands } from './handlers/commandLoader.js';
import { loadEvents } from './handlers/eventLoader.js';
import { AlertScheduler } from './services/alertScheduler.js';
import type { BotContext } from './types.js';

/**
 * Construct and fully wire the Discord client: intents, commands, events and
 * the shared context object that every handler receives.
 *
 * We request only the Guilds intent. Slash commands and the monitoring
 * features need nothing more, which keeps the bot's privilege footprint
 * minimal (no message-content or member-list privileged intents required).
 */
export async function createClient(): Promise<Client> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  const commands = await loadCommands();

  // The context object is dependency-injected into every command and event,
  // avoiding hidden global state and making handlers easy to reason about.
  const context: BotContext = {
    client,
    commands,
    alertScheduler: new AlertScheduler(client),
  };

  await loadEvents(client, context);

  return client;
}
