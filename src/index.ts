import type { Client } from 'discord.js';
import { assertBootConfig, config, configIssues } from './config/index.js';
import { logger } from './logger.js';
import { createClient } from './client.js';

/**
 * Application entry point.
 * Validates configuration, builds the client, logs in, and installs
 * graceful-shutdown and last-resort error handlers.
 */
async function main(): Promise<void> {
  assertBootConfig();
  reportConfigIssues();

  logger.info(
    {
      configPath: config.configPath,
      services: config.services.length,
      websites: config.websites.length,
      commands: config.commands.length,
      files: config.files.length,
    },
    'configuration loaded',
  );

  const client = await createClient();

  installProcessHandlers(client);

  await client.login(config.discord.token);
}

/**
 * Log everything the config loader flagged.
 *
 * Invalid inventory entries are dropped rather than fatal, so this is the one
 * place an operator learns that a website or service silently did not load.
 * The same list is available in Discord via `/config issues`.
 */
function reportConfigIssues(): void {
  for (const issue of configIssues) {
    const line = `${issue.scope}: ${issue.message}`;
    if (issue.level === 'error') {
      logger.error({ scope: issue.scope }, `config error — ${line}`);
    } else {
      logger.warn({ scope: issue.scope }, `config warning — ${line}`);
    }
  }
}

/**
 * Wire OS signals and unexpected-error events to a clean shutdown so the
 * supervisor sees a well-behaved service (fast, deterministic stop; proper
 * exit codes).
 */
function installProcessHandlers(client: Client): void {
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutting down');
    void client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception');
    void client.destroy();
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.fatal({ err: message, stack }, 'fatal error during startup');
  process.exit(1);
});
