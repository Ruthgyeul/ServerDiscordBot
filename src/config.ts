import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import type { AppConfig, MonitorConfig, ServiceConfig, WebsiteConfig } from './types.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

/** Shape of the on-disk config.json (all sections optional / partial). */
interface RawJsonConfig {
  monitor?: Partial<Omit<MonitorConfig, 'thresholds'>> & {
    thresholds?: Partial<MonitorConfig['thresholds']>;
  };
  services?: ServiceConfig[];
  websites?: WebsiteConfig[];
}

/** Parse a comma-separated env var into a trimmed, non-empty string array. */
function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Read and parse the JSON config file that describes the managed services
 * and websites. Falls back to the example file if the real one is missing,
 * so the bot can still boot in a fresh checkout.
 */
function loadJsonConfig(): RawJsonConfig {
  const primary = resolve(projectRoot, 'config/config.json');
  const example = resolve(projectRoot, 'config/config.example.json');
  const path = existsSync(primary) ? primary : example;

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RawJsonConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load config file at ${path}: ${message}`);
  }
}

const json = loadJsonConfig();

/**
 * Central, validated configuration object. Secrets come from the environment;
 * operational settings (services, websites, thresholds) come from config.json.
 */
export const config: AppConfig = {
  discord: {
    token: process.env.DISCORD_TOKEN ?? '',
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    guildId: process.env.DISCORD_GUILD_ID ?? '',
    alertChannelId: process.env.ALERT_CHANNEL_ID ?? '',
  },
  access: {
    adminUserIds: parseList(process.env.ADMIN_USER_IDS),
    adminRoleIds: parseList(process.env.ADMIN_ROLE_IDS),
  },
  // Bot branding & presence. All configurable via .env so the bot's identity
  // can be changed without touching code. Note: BOT_NAME is the display name
  // used in embeds, the health-check User-Agent, etc. — the actual Discord
  // account username is set in the Developer Portal, not here.
  bot: {
    name: process.env.BOT_NAME ?? 'ServerDiscordBot',
    description: process.env.BOT_DESCRIPTION ?? 'Linux host & service management bot',
    presenceStatus: process.env.BOT_PRESENCE_STATUS ?? 'online',
    activityType: process.env.BOT_ACTIVITY_TYPE ?? 'Watching',
    activityText: process.env.BOT_ACTIVITY_TEXT ?? 'the server 🖥️',
    embedFooter: process.env.BOT_EMBED_FOOTER ?? '',
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  env: process.env.NODE_ENV ?? 'development',
  monitor: {
    enabled: json.monitor?.enabled ?? true,
    intervalSeconds: json.monitor?.intervalSeconds ?? 60,
    alertCooldownMinutes: json.monitor?.alertCooldownMinutes ?? 15,
    thresholds: {
      cpuPercent: json.monitor?.thresholds?.cpuPercent ?? 85,
      memoryPercent: json.monitor?.thresholds?.memoryPercent ?? 90,
      diskPercent: json.monitor?.thresholds?.diskPercent ?? 90,
    },
  },
  services: json.services ?? [],
  websites: json.websites ?? [],
};

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

/**
 * Look up a managed service by its short name (case-insensitive).
 * Only services present in config can ever be controlled — this is the
 * allowlist that prevents arbitrary systemctl execution.
 */
export function findService(name: string): ServiceConfig | null {
  const needle = name?.toLowerCase();
  return config.services.find((s) => s.name.toLowerCase() === needle) ?? null;
}

/** Look up a managed website by its short name (case-insensitive). */
export function findWebsite(name: string): WebsiteConfig | null {
  const needle = name?.toLowerCase();
  return config.websites.find((w) => w.name.toLowerCase() === needle) ?? null;
}

export { projectRoot };
