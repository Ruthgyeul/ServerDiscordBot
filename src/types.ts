import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Permission } from './lib/permissions.js';
import type { AlertScheduler } from './services/alertScheduler.js';

/* ────────────────────────────────────────────────────────────────────────────
 * Configuration model
 *
 * Everything the bot knows about the server it manages lives in these shapes.
 * Secrets and identity come from `.env`; the inventory (what to watch, what
 * may be run) comes from `config.json`. Adding a new website, service,
 * command or file is a config edit — never a code change.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Common fields shared by every addressable entry in the inventory. */
export interface NamedEntry {
  /** Short, unique key used in commands and autocomplete (e.g. "portfolio"). */
  name: string;
  /** Human-readable label shown in embeds. */
  label: string;
  description?: string;
}

/** A managed systemd unit, as declared in config.json. */
export interface ServiceConfig extends NamedEntry {
  /** The systemd unit this maps to — the allowlisted target. */
  unit: string;
  /** Marks the unit as load-bearing; surfaced in listings and alerts. */
  critical?: boolean;
}

/** A website to health-check, as declared in config.json. */
export interface WebsiteConfig extends NamedEntry {
  url: string;
  /** Expected HTTP status for a healthy response (default 200). */
  expectStatus: number;
  /** Per-request timeout in milliseconds (default 8000). */
  timeoutMs: number;
  /** Check TLS certificate expiry for https URLs (default true). */
  checkCert: boolean;
  /** Optional `services[].name` backing this site, linked in reports. */
  service?: string;
}

/**
 * An allowlisted command exposed through `/run`.
 *
 * `command` + `args` are passed to execFile as a fixed argv — never to a
 * shell — so nothing here can be turned into a shell injection. The allowlist
 * itself is the security boundary: if it is not in config.json, it cannot run.
 */
export interface RunCommandConfig extends NamedEntry {
  /** Executable, resolved via PATH. */
  command: string;
  /** Fixed arguments, always passed. */
  args: string[];
  /** Allow the caller to append extra arguments (off by default). */
  allowArgs: boolean;
  timeoutMs: number;
  /** Run through `sudo -n` (needs a matching sudoers rule). */
  sudo: boolean;
  /** Require an explicit button confirmation before running. */
  confirm: boolean;
}

/** An allowlisted file exposed through `/file`. */
export interface FileTargetConfig extends NamedEntry {
  /** Absolute path on the host. */
  path: string;
  /** Upper bound on lines a single `/file tail` may return. */
  maxLines: number;
}

/** Resource / health alerting thresholds. */
export interface MonitorThresholds {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  /** Warn when a TLS certificate expires within this many days. */
  certExpiryDays: number;
  /** Warn when a site responds slower than this (0 disables). */
  responseMs: number;
}

/** Individual monitor passes, each independently switchable. */
export interface MonitorChecks {
  resources: boolean;
  services: boolean;
  websites: boolean;
  certificates: boolean;
}

export interface MonitorConfig {
  enabled: boolean;
  intervalSeconds: number;
  alertCooldownMinutes: number;
  checks: MonitorChecks;
  thresholds: MonitorThresholds;
  /** Mount points to exclude from disk reporting and alerting. */
  ignoreMounts: string[];
  /** How many hours of samples to keep in memory for trends and uptime. */
  historyHours: number;
}

/** How the bot talks to the host it manages. */
export interface SystemConfig {
  /** Prefix systemctl/journalctl with `sudo -n` (scoped sudoers rule). */
  useSudo: boolean;
  /** Target system units, or the bot user's own `--user` units. */
  scope: 'system' | 'user';
  /** Default timeout for one-off host commands. */
  commandTimeoutMs: number;
}

/** Bot branding & presence — all sourced from the environment. */
export interface BotConfig {
  name: string;
  description: string;
  presenceStatus: string;
  activityType: string;
  activityText: string;
  embedFooter: string;
  /** Accent color for informational embeds, as a 24-bit integer. */
  accentColor: number;
}

export interface DiscordConfig {
  token: string;
  clientId: string;
  guildId: string;
  alertChannelId: string;
  /** Optional channel receiving an audit trail of every privileged action. */
  auditChannelId: string;
}

export interface AccessConfig {
  adminUserIds: string[];
  adminRoleIds: string[];
}

export interface AppConfig {
  discord: DiscordConfig;
  access: AccessConfig;
  bot: BotConfig;
  system: SystemConfig;
  logLevel: string;
  env: string;
  monitor: MonitorConfig;
  services: ServiceConfig[];
  websites: WebsiteConfig[];
  commands: RunCommandConfig[];
  files: FileTargetConfig[];
  /** Absolute path of the config file that was actually loaded. */
  configPath: string;
}

/** A single problem found while loading configuration. */
export interface ConfigIssue {
  /** Where it came from, e.g. "env.BOT_ACCENT_COLOR" or "websites[1]". */
  scope: string;
  message: string;
  /** `error` entries are dropped from the inventory; `warning` are kept. */
  level: 'error' | 'warning';
}

/* ────────────────────────────────────────────────────────────────────────────
 * Command / event contracts
 * ──────────────────────────────────────────────────────────────────────────── */

/** Any of the slash-command builder shapes a command's `data` may take. */
export type SlashCommandData =
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

/**
 * The context object dependency-injected into every command and event handler,
 * avoiding hidden global state.
 */
export interface BotContext {
  client: Client;
  commands: Collection<string, CommandModule>;
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
  /**
   * Optional handler for option autocomplete. Implementing this lets a command
   * offer choices sourced from config at runtime, so inventory changes need no
   * re-registration of the command.
   */
  autocomplete?(
    interaction: AutocompleteInteraction,
    context: BotContext,
  ): Promise<void> | void;
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
