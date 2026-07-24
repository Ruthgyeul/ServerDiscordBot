/**
 * The configuration model: everything the bot knows about the server it
 * manages.
 *
 * Kept apart from the Discord-facing contracts in `bot.ts` because the two
 * change for different reasons — this file moves when the inventory gains a
 * capability, that one when the command or event contract changes.
 */

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
  /**
   * Anchored regular expression every caller-supplied argument must match.
   *
   * The built-in character check prevents shell injection, but not *argument*
   * injection: `allowArgs` on a command that reads files lets a caller name
   * any path the bot can read, sidestepping the `files` allowlist. Constrain
   * the shape of what a command will accept — e.g. `^[0-9]{1,4}$` for a line
   * count. Empty means the character check alone.
   */
  argPattern: string;
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
  /** Warn above this CPU temperature in °C (0 disables). */
  cpuTempCelsius: number;
}

/** Individual monitor passes, each independently switchable. */
export interface MonitorChecks {
  resources: boolean;
  services: boolean;
  websites: boolean;
  certificates: boolean;
  /**
   * Alert on any failed systemd unit, including ones outside the allowlist.
   * Off by default: valuable on a host you own end to end, noisy on one with
   * units you neither manage nor care about.
   */
  failedUnits: boolean;
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
  /**
   * Append a live health summary to the activity text, refreshed periodically.
   * Turns the member list into an at-a-glance status light — no command needed
   * to see that something is wrong.
   */
  dynamicPresence: boolean;
  /** How often to refresh the dynamic presence, in seconds. */
  presenceRefreshSeconds: number;
}

export interface DiscordConfig {
  token: string;
  clientId: string;
  guildId: string;
  alertChannelId: string;
  /** Optional channel receiving an audit trail of every privileged action. */
  auditChannelId: string;
  /**
   * Optional user to DM on failures the bot cannot report any other way.
   * A crash loop or a broken alert channel is exactly when the normal paths
   * are unavailable, so this is the last-resort route to a human.
   */
  ownerUserId: string;
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
  /** Command names to refuse, without removing them from the build. */
  disabledCommands: string[];
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
