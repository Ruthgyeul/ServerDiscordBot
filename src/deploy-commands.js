import { REST, Routes } from 'discord.js';
import { config, assertBootConfig } from './config.js';
import { logger } from './logger.js';
import { loadCommands } from './handlers/commandLoader.js';

/**
 * Register (publish) slash commands with Discord.
 *
 * Run this whenever commands are added or their `data` definitions change:
 *   npm run deploy
 *
 * If DISCORD_GUILD_ID is set, commands register to that guild and appear
 * instantly — ideal for development. Otherwise they register globally and can
 * take up to an hour to propagate.
 */
async function deploy() {
  assertBootConfig();

  const commands = await loadCommands();
  const body = commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(config.discord.token);

  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
    : Routes.applicationCommands(config.discord.clientId);

  logger.info(
    { count: body.length, scope: config.discord.guildId ? 'guild' : 'global' },
    'registering slash commands',
  );

  const data = await rest.put(route, { body });
  logger.info({ count: data.length }, 'slash commands registered');
}

deploy().catch((error) => {
  logger.fatal({ err: error.message, stack: error.stack }, 'failed to deploy commands');
  process.exit(1);
});
