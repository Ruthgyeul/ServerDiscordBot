import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { config, assertBootConfig } from './config/index.js';
import { logger } from './logger.js';
import { loadCommands } from './handlers/commandLoader.js';
import { describeDiff, diffCommandNames } from './lib/commandDiff.js';

/**
 * Register (publish) slash commands with Discord, clearing stale ones first.
 *
 *   npm run deploy            register (compiled)
 *   npm run deploy:dev        register (tsx, no build)
 *   npm run deploy:clear      remove every registration, register nothing
 *   npm run deploy -- --dry-run   report what would change, write nothing
 *
 * Registration itself is a full replacement: `PUT` overwrites the entire
 * command set for one scope, so a command that was renamed or deleted in code
 * disappears from that scope automatically.
 *
 * What that does *not* fix is the other scope. Commands are registered either
 * to one guild or globally, and Discord keeps those sets independently — so
 * moving between them (setting or clearing `DISCORD_GUILD_ID`) leaves the old
 * set behind and every command shows up twice in the picker. This script
 * therefore always wipes the scope it is not deploying to.
 *
 * Note that this is server-side state. Discord *clients* also cache the
 * command list locally; if a stale entry lingers in the picker after a
 * successful deploy, reload the client (Ctrl/Cmd+R).
 */

/** The fields we care about from a registered command. */
interface RegisteredCommand {
  id: string;
  name: string;
}

interface Guild {
  id: string;
  name: string;
}

/** A command scope we can read, replace or wipe. */
interface Scope {
  label: string;
  route: `/${string}`;
}

async function main(): Promise<void> {
  assertBootConfig();

  const rest = new REST().setToken(config.discord.token);
  const clearOnly = process.argv.includes('--clear');
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) logger.info('dry run — reporting the plan, writing nothing');

  const target = targetScope();
  const stale = await staleScopes(rest, target);

  // Clear first: if registration fails afterwards, the operator is left with
  // nothing rather than with two competing sets of commands.
  for (const scope of stale) {
    await clearScope(rest, scope, dryRun);
  }

  if (clearOnly) {
    await clearScope(rest, target, dryRun);
    logger.info(
      dryRun ? 'would remove all registrations' : 'all slash command registrations removed',
    );
    return;
  }

  await register(rest, target, dryRun);
}

/** Where this deployment publishes to, decided by DISCORD_GUILD_ID. */
function targetScope(): Scope {
  const { clientId, guildId } = config.discord;

  return guildId
    ? {
        label: `guild ${guildId}`,
        route: Routes.applicationGuildCommands(clientId, guildId),
      }
    : { label: 'global', route: Routes.applicationCommands(clientId) };
}

/**
 * Every scope that may hold leftovers from an earlier deployment.
 *
 * Deploying to a guild means global registrations are stale. Deploying
 * globally means *any* guild-specific set is stale — and since the guild IDs
 * are not in config at that point, we ask Discord which guilds the bot is in.
 */
async function staleScopes(rest: REST, target: Scope): Promise<Scope[]> {
  const { clientId, guildId } = config.discord;

  if (guildId) {
    return [{ label: 'global', route: Routes.applicationCommands(clientId) }];
  }

  const guilds = (await rest.get(Routes.userGuilds())) as Guild[];
  return guilds
    .map((guild) => ({
      label: `guild ${guild.name} (${guild.id})`,
      route: Routes.applicationGuildCommands(clientId, guild.id),
    }))
    .filter((scope) => scope.route !== target.route);
}

/** Remove every command registered in a scope, skipping the call if it is empty. */
async function clearScope(rest: REST, scope: Scope, dryRun: boolean): Promise<void> {
  const existing = (await rest.get(scope.route)) as RegisteredCommand[];
  if (existing.length === 0) {
    logger.debug({ scope: scope.label }, 'scope already empty');
    return;
  }

  const names = existing.map((command) => command.name);
  if (!dryRun) await rest.put(scope.route, { body: [] });

  logger.info(
    { scope: scope.label, removed: names },
    `${dryRun ? 'would clear' : 'cleared'} ${existing.length} stale command(s) ` +
      `from ${scope.label}: ${names.join(', ')}`,
  );
}

/** Publish the current command set, reporting what changed. */
async function register(rest: REST, scope: Scope, dryRun: boolean): Promise<void> {
  const commands = await loadCommands();
  const body: RESTPostAPIApplicationCommandsJSONBody[] = commands.map((command) =>
    command.data.toJSON(),
  );

  const before = (await rest.get(scope.route)) as RegisteredCommand[];
  const diff = diffCommandNames(
    before.map((command) => command.name),
    body.map((command) => command.name),
  );

  if (dryRun) {
    logger.info(
      { scope: scope.label, total: body.length, ...diff },
      `would register ${body.length} command(s) to ${scope.label}` + describeDiff(diff),
    );
    return;
  }

  logger.info(
    { count: body.length, scope: scope.label },
    `registering ${body.length} slash command(s) to ${scope.label}`,
  );

  const registered = (await rest.put(scope.route, { body })) as RegisteredCommand[];

  logger.info(
    { scope: scope.label, total: registered.length, ...diff },
    `registered ${registered.length} command(s)` + describeDiff(diff),
  );

  if (scope.label === 'global') {
    logger.warn('global commands can take up to an hour to propagate to clients');
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  logger.fatal({ err: message, stack }, 'failed to deploy commands');
  process.exit(1);
});
