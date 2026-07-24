import type { Client } from 'discord.js';
import { assertBootConfig, config, configIssues } from './config/index.js';
import { logger } from './logger.js';
import { createClient } from './client.js';
import { warningEmbed } from './lib/embeds.js';

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
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    // A second signal during shutdown must not restart the sequence.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'shutting down');
    // Best-effort goodbye so a restart is a visible event rather than silence.
    // Bounded, because a clean exit matters more than the notice arriving.
    await withTimeout(announceShutdown(client, signal), 2000);
    await client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error.message, stack: error.stack }, 'uncaught exception');
    void client.destroy();
    process.exit(1);
  });
}

/** Post a shutdown notice to the alert channel, if one is configured. */
async function announceShutdown(client: Client, signal: string): Promise<void> {
  const channelId = config.discord.alertChannelId;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) return;

  await channel.send({
    embeds: [
      warningEmbed(
        `${config.bot.name} is shutting down`,
        `Received ${signal}. Monitoring stops until the bot is back.`,
      ),
    ],
  });
}

/** Resolve when `work` settles or the deadline passes, whichever is first. */
async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

  try {
    await Promise.race([work.catch(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.fatal({ err: message, stack }, 'fatal error during startup');
  process.exit(1);
});
