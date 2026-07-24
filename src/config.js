import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

/**
 * Parse a comma-separated env var into a trimmed, non-empty string array.
 * @param {string | undefined} value
 * @returns {string[]}
 */
function parseList(value) {
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
function loadJsonConfig() {
  const primary = resolve(projectRoot, 'config/config.json');
  const example = resolve(projectRoot, 'config/config.example.json');
  const path = existsSync(primary) ? primary : example;

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to load config file at ${path}: ${error.message}`);
  }
}

const json = loadJsonConfig();

/**
 * Central, validated configuration object. Secrets come from the environment;
 * operational settings (services, websites, thresholds) come from config.json.
 */
export const config = {
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
export function assertBootConfig() {
  const missing = [];
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
 * @param {string} name
 */
export function findService(name) {
  const needle = name?.toLowerCase();
  return config.services.find((s) => s.name.toLowerCase() === needle) ?? null;
}

/**
 * Look up a managed website by its short name (case-insensitive).
 * @param {string} name
 */
export function findWebsite(name) {
  const needle = name?.toLowerCase();
  return config.websites.find((w) => w.name.toLowerCase() === needle) ?? null;
}

export { projectRoot };
