import { assertBootConfig, config } from './config.js';
import { logger } from './logger.js';
import { createClient } from './client.js';

/**
 * Application entry point.
 * Validates configuration, builds the client, logs in, and installs
 * graceful-shutdown and last-resort error handlers.
 */
async function main() {
  assertBootConfig();

  const client = await createClient();

  installProcessHandlers(client);

  await client.login(config.discord.token);
}

/**
 * Wire OS signals and unexpected-error events to a clean shutdown so systemd
 * sees a well-behaved service (fast, deterministic stop; proper exit codes).
 * @param {import('discord.js').Client} client
 */
function installProcessHandlers(client) {
  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception');
    client.destroy();
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error.message, stack: error.stack }, 'fatal error during startup');
  process.exit(1);
});
