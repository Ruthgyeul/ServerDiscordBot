import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EnvReader, loadDotenv } from './env.js';
import {
  checkReferences,
  normalizeCommands,
  normalizeFiles,
  normalizeMonitor,
  normalizeServices,
  normalizeWebsites,
  type RawConfig,
} from './schema.js';
import type {
  AppConfig,
  ConfigIssue,
  FileTargetConfig,
  NamedEntry,
  RunCommandConfig,
  ServiceConfig,
  WebsiteConfig,
} from '../types.js';

/**
 * The single place the bot learns anything about itself or the host.
 *
 *   `.env`             → identity, secrets, access control, host access mode
 *   `config/config.json` → inventory: services, websites, commands, files,
 *                          monitoring thresholds
 *
 * Both sources are re-readable at runtime via `reloadConfig()` (exposed as
 * `/config reload`), so day-to-day changes — a new website, a new allowlisted
 * command, a different threshold — never require a restart or a code edit.
 *
 * This module deliberately does not import the logger: the logger is
 * configured *from* this module, and keeping the dependency one-directional
 * avoids an import cycle. Problems are collected in `configIssues` and
 * reported by the caller.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `src/config/` in dev, `dist/config/` once compiled — both are two levels deep. */
const projectRoot = resolve(__dirname, '../..');

/** Presence / activity values discord.js accepts, mirrored for validation. */
const PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;
const ACTIVITY_TYPES = ['playing', 'watching', 'listening', 'competing', 'custom'] as const;
const SYSTEMD_SCOPES = ['system', 'user'] as const;
const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

/** Discord blurple — the default accent when BOT_ACCENT_COLOR is unset. */
const DEFAULT_ACCENT = 0x5865f2;

/** Problems found while loading the current configuration. */
export const configIssues: ConfigIssue[] = [];

/** Resolve the config file to read: `CONFIG_PATH`, then config.json, then the example. */
function resolveConfigPath(): string {
  const override = process.env.CONFIG_PATH?.trim();
  if (override) return resolve(projectRoot, override);

  const primary = resolve(projectRoot, 'config/config.json');
  if (existsSync(primary)) return primary;

  // A fresh checkout should still boot; the example doubles as a live default.
  return resolve(projectRoot, 'config/config.example.json');
}

/** Read and parse the inventory file, degrading to an empty inventory on error. */
function readConfigFile(path: string, issues: ConfigIssue[]): RawConfig {
  if (!existsSync(path)) {
    issues.push({
      scope: 'config',
      message: `Config file not found at ${path}; running with an empty inventory.`,
      level: 'error',
    });
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      issues.push({
        scope: 'config',
        message: `${path} must contain a JSON object.`,
        level: 'error',
      });
      return {};
    }
    return parsed as RawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push({
      scope: 'config',
      message: `Failed to parse ${path}: ${message}. Keeping an empty inventory.`,
      level: 'error',
    });
    return {};
  }
}

/** Build a complete, validated configuration from the current environment + file. */
function buildConfig(issues: ConfigIssue[]): AppConfig {
  const env = new EnvReader(issues);
  const configPath = resolveConfigPath();
  const json = readConfigFile(configPath, issues);

  const services = normalizeServices(json['services'], issues);
  const websites = normalizeWebsites(json['websites'], issues);
  checkReferences(websites, services, issues);

  return {
    discord: {
      token: env.string('DISCORD_TOKEN'),
      clientId: env.string('DISCORD_CLIENT_ID'),
      guildId: env.string('DISCORD_GUILD_ID'),
      alertChannelId: env.string('ALERT_CHANNEL_ID'),
      auditChannelId: env.string('AUDIT_CHANNEL_ID'),
    },
    access: {
      adminUserIds: env.list('ADMIN_USER_IDS'),
      adminRoleIds: env.list('ADMIN_ROLE_IDS'),
    },
    // Branding & presence. The Discord account's username and avatar are set
    // in the Developer Portal; everything the bot renders itself comes from here.
    bot: {
      name: env.string('BOT_NAME', 'ServerDiscordBot'),
      description: env.string('BOT_DESCRIPTION', 'Linux host & service management bot'),
      presenceStatus: env.enum('BOT_PRESENCE_STATUS', PRESENCE_STATUSES, 'online'),
      activityType: env.enum('BOT_ACTIVITY_TYPE', ACTIVITY_TYPES, 'watching'),
      activityText: env.string('BOT_ACTIVITY_TEXT', 'the server 🖥️'),
      embedFooter: env.string('BOT_EMBED_FOOTER'),
      accentColor: env.color('BOT_ACCENT_COLOR', DEFAULT_ACCENT),
    },
    system: {
      useSudo: env.bool('SYSTEMCTL_SUDO', false),
      scope: env.enum('SYSTEMCTL_SCOPE', SYSTEMD_SCOPES, 'system'),
      commandTimeoutMs: env.int('COMMAND_TIMEOUT_MS', 15000, 1000, 120000),
    },
    logLevel: env.enum('LOG_LEVEL', LOG_LEVELS, 'info'),
    env: env.string('NODE_ENV', 'development'),
    monitor: normalizeMonitor(json['monitor'], issues),
    services,
    websites,
    commands: normalizeCommands(json['commands'], issues),
    files: normalizeFiles(json['files'], issues),
    configPath,
  };
}

loadDotenv();

/**
 * The live configuration object.
 *
 * Its identity is stable for the lifetime of the process: `reloadConfig()`
 * replaces the contents in place, so every module that captured this import at
 * startup automatically observes the new values.
 */
export const config: AppConfig = buildConfig(configIssues);

export interface ReloadResult {
  issues: ConfigIssue[];
  configPath: string;
  counts: { services: number; websites: number; commands: number; files: number };
}

/**
 * Re-read `.env` and the inventory file and apply them in place.
 *
 * Note that a few values are only consumed once, at startup, and therefore
 * need a restart to take effect: the Discord token, the log level, and the
 * registered slash-command definitions (which additionally need `npm run
 * deploy`). Everything else — thresholds, intervals, allowlists, branding —
 * takes effect on the next use.
 */
export function reloadConfig(): ReloadResult {
  loadDotenv(true);

  const issues: ConfigIssue[] = [];
  const next = buildConfig(issues);

  // Replace contents rather than the reference, so existing imports stay valid.
  Object.assign(config, next);
  configIssues.length = 0;
  configIssues.push(...issues);

  return {
    issues,
    configPath: next.configPath,
    counts: {
      services: next.services.length,
      websites: next.websites.length,
      commands: next.commands.length,
      files: next.files.length,
    },
  };
}

/**
 * Validate configuration required for the bot to start. Throws with a clear,
 * actionable message so misconfiguration fails fast at boot rather than later.
 */
export function assertBootConfig(): void {
  const missing: string[] = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (!config.discord.clientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.',
    );
  }
}

/** Case-insensitive lookup by `name` across any inventory list. */
function findByName<T extends NamedEntry>(list: T[], name: string): T | null {
  const needle = name?.trim().toLowerCase();
  if (!needle) return null;
  return list.find((entry) => entry.name.toLowerCase() === needle) ?? null;
}

/**
 * Look up a managed service by its short name.
 * Only services present in config can ever be controlled — this is the
 * allowlist that prevents arbitrary systemctl execution.
 */
export function findService(name: string): ServiceConfig | null {
  return findByName(config.services, name);
}

export function findWebsite(name: string): WebsiteConfig | null {
  return findByName(config.websites, name);
}

/** Look up an allowlisted command. Anything not in config can never run. */
export function findCommand(name: string): RunCommandConfig | null {
  return findByName(config.commands, name);
}

/** Look up an allowlisted file. Anything not in config can never be read. */
export function findFile(name: string): FileTargetConfig | null {
  return findByName(config.files, name);
}

export { projectRoot };
