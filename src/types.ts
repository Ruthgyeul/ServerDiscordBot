import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Permission } from './lib/permissions.js';
import type { AlertScheduler } from './services/alertScheduler.js';

/** A managed systemd unit, as declared in config.json. */
export interface ServiceConfig {
  /** Short, user-facing key (used in command choices). */
  name: string;
  /** Human-readable label. */
  label: string;
  /** The systemd unit this maps to — the allowlisted target. */
  unit: string;
  description?: string;
}

/** A website to health-check, as declared in config.json. */
export interface WebsiteConfig {
  name: string;
  label: string;
  url: string;
  /** Expected HTTP status for a healthy response (default 200). */
  expectStatus?: number;
  /** Per-request timeout in milliseconds (default 8000). */
  timeoutMs?: number;
}

/** Resource alerting thresholds (percentages). */
export interface MonitorThresholds {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
}

export interface MonitorConfig {
  enabled: boolean;
  intervalSeconds: number;
  alertCooldownMinutes: number;
  thresholds: MonitorThresholds;
}

/** Bot branding & presence — all sourced from the environment. */
export interface BotConfig {
  name: string;
  description: string;
  presenceStatus: string;
  activityType: string;
  activityText: string;
  embedFooter: string;
}

export interface AppConfig {
  discord: {
    token: string;
    clientId: string;
    guildId: string;
    alertChannelId: string;
  };
  access: {
    adminUserIds: string[];
    adminRoleIds: string[];
  };
  bot: BotConfig;
  logLevel: string;
  env: string;
  monitor: MonitorConfig;
  services: ServiceConfig[];
  websites: WebsiteConfig[];
}

/** Any of the slash-command builder shapes a command's `data` may take. */
export type SlashCommandData =
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

/**
 * The context object dependency-injected into every command and event handler,
 * avoiding hidden global state.
 */
export interface BotContext {
  client: Client;
  commands: Map<string, CommandModule>;
  alertScheduler: AlertScheduler;
}

/** Contract every file under src/commands/ must satisfy. */
export interface CommandModule {
  data: SlashCommandData;
  /** Required access level; defaults to admin when omitted. */
  permission?: Permission;
  /** Filled in by the loader from the containing folder name. */
  category?: string;
  execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> | void;
}

/**
 * Contract every file under src/events/ must satisfy. `execute` receives the
 * event's native arguments followed by the shared context (appended by the
 * loader).
 */
export interface EventModule {
  name: string;
  once?: boolean;
  execute(...args: unknown[]): Promise<void> | void;
}
