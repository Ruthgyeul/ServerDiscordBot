import { isAbsolute } from 'node:path';
import type {
  ConfigIssue,
  FileTargetConfig,
  MonitorConfig,
  RunCommandConfig,
  ServiceConfig,
  WebsiteConfig,
} from '../types/index.js';

/**
 * Validation and normalization for `config.json`.
 *
 * Design rules, in priority order:
 *
 *  1. **Fail closed.** An entry that does not validate is *dropped*, never
 *     half-loaded. These lists are security allowlists — a malformed service,
 *     command or file must not become a partially-trusted target.
 *  2. **Never crash on bad config.** One broken entry must not take the bot
 *     down; the rest of the inventory keeps working and the problem is
 *     reported through logs and `/config show`.
 *  3. **Report everything at once.** Issues accumulate so a single edit can fix
 *     them all, instead of playing whack-a-mole one restart at a time.
 */

/** Defaults for everything that may be omitted from config.json. */
export const DEFAULTS = {
  monitor: {
    enabled: true,
    intervalSeconds: 60,
    alertCooldownMinutes: 15,
    checks: {
      resources: true,
      services: true,
      websites: true,
      certificates: true,
      failedUnits: false,
    },
    thresholds: {
      cpuPercent: 85,
      memoryPercent: 90,
      diskPercent: 90,
      certExpiryDays: 14,
      responseMs: 0,
      cpuTempCelsius: 0,
    },
    ignoreMounts: [] as string[],
    historyHours: 24,
  },
  website: { expectStatus: 200, timeoutMs: 8000, checkCert: true },
  command: { timeoutMs: 15000, allowArgs: false, sudo: false, confirm: false },
  file: { maxLines: 200 },
} as const;

/**
 * Names are autocomplete *values*, not Discord command names.
 *
 * Discord requires command names to be lowercase, but that rule does not
 * extend to option values — and a service is very often named after its unit
 * file, which is frequently capitalised (`DefaultWeb.service`). Forcing
 * lowercase here would mean the obvious config is the rejected one.
 *
 * What still matters: no whitespace (it makes values ambiguous to type), no
 * characters that need escaping in the places these end up (embeds, alert
 * keys, log fields), and a length inside Discord's 100-character value limit.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The raw, untrusted shape of a parsed config file. */
export type RawConfig = Record<string, unknown>;

/** Collects issues for one entry and reports whether it may be kept. */
class EntryContext {
  readonly scope: string;
  private readonly issues: ConfigIssue[];
  private failed = false;

  constructor(scope: string, issues: ConfigIssue[]) {
    this.scope = scope;
    this.issues = issues;
  }

  error(message: string): void {
    this.failed = true;
    this.issues.push({ scope: this.scope, message, level: 'error' });
  }

  warn(message: string): void {
    this.issues.push({ scope: this.scope, message, level: 'warning' });
  }

  get ok(): boolean {
    return !this.failed;
  }
}

function asRecord(value: unknown): RawConfig | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawConfig)
    : null;
}

function asArray(value: unknown, scope: string, issues: ConfigIssue[]): unknown[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  issues.push({ scope, message: 'Expected an array; ignoring this section.', level: 'error' });
  return [];
}

function readString(source: RawConfig, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(
  source: RawConfig,
  key: string,
  fallback: number,
  ctx: EntryContext,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    ctx.warn(`"${key}" must be a number; using ${fallback}.`);
    return fallback;
  }
  if (value < min || value > max) {
    ctx.warn(`"${key}" must be between ${min} and ${max}; using ${fallback}.`);
    return fallback;
  }
  return value;
}

function readBoolean(
  source: RawConfig,
  key: string,
  fallback: boolean,
  ctx: EntryContext,
): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    ctx.warn(`"${key}" must be true or false; using ${fallback}.`);
    return fallback;
  }
  return value;
}

function readStringArray(source: RawConfig, key: string, ctx: EntryContext): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    ctx.warn(`"${key}" must be an array of strings; ignoring it.`);
    return [];
  }
  return value as string[];
}

/** Validate the identity fields every inventory entry shares. */
function readIdentity(
  source: RawConfig,
  ctx: EntryContext,
): { name: string; label: string; description?: string } | null {
  const name = readString(source, 'name');
  if (!name) {
    ctx.error('Missing required "name".');
    return null;
  }
  if (!NAME_PATTERN.test(name)) {
    ctx.error(
      `Invalid name "${name}". Use 1–64 letters, digits, dot, dash or underscore, ` +
        'starting with a letter or digit.',
    );
    return null;
  }

  const label = readString(source, 'label') ?? name;
  const description = readString(source, 'description');
  return description ? { name, label, description } : { name, label };
}

/**
 * Generic entry-list normalizer: shared iteration, per-entry error isolation
 * and duplicate-name rejection, so each section below only describes its own
 * fields.
 */
function normalizeEntries<T extends { name: string }>(
  raw: unknown,
  section: string,
  issues: ConfigIssue[],
  build: (
    source: RawConfig,
    identity: NonNullable<ReturnType<typeof readIdentity>>,
    ctx: EntryContext,
  ) => T | null,
): T[] {
  const entries = asArray(raw, section, issues);
  const result: T[] = [];
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const ctx = new EntryContext(`${section}[${index}]`, issues);
    const source = asRecord(entry);
    if (!source) {
      ctx.error('Entry must be an object.');
      return;
    }

    const identity = readIdentity(source, ctx);
    if (!identity) return;

    // Compared case-insensitively because lookups are: `findService("web")`
    // must not silently resolve to whichever of "Web" and "web" came first.
    const key = identity.name.toLowerCase();
    if (seen.has(key)) {
      ctx.error(
        `Duplicate name "${identity.name}" (names are matched case-insensitively); ` +
          'keeping the first definition.',
      );
      return;
    }

    const built = build(source, identity, ctx);
    if (!built || !ctx.ok) return;

    seen.add(key);
    result.push(built);
  });

  return result;
}

/** systemd unit names must be a single bare token — no paths, no separators. */
const UNIT_PATTERN = /^[A-Za-z0-9@._\\-]+$/;

export function normalizeServices(raw: unknown, issues: ConfigIssue[]): ServiceConfig[] {
  return normalizeEntries(raw, 'services', issues, (source, identity, ctx) => {
    const unit = readString(source, 'unit');
    if (!unit) {
      ctx.error('Missing required "unit" (e.g. "portfolio.service").');
      return null;
    }
    if (!UNIT_PATTERN.test(unit)) {
      ctx.error(`Invalid unit "${unit}"; expected a bare systemd unit name.`);
      return null;
    }
    if (!/\.(service|socket|timer|target|mount|path)$/.test(unit)) {
      ctx.warn(`Unit "${unit}" has no known suffix; systemd will assume ".service".`);
    }

    return {
      ...identity,
      unit,
      critical: readBoolean(source, 'critical', false, ctx),
    };
  });
}

export function normalizeWebsites(raw: unknown, issues: ConfigIssue[]): WebsiteConfig[] {
  return normalizeEntries(raw, 'websites', issues, (source, identity, ctx) => {
    const url = readString(source, 'url');
    if (!url) {
      ctx.error('Missing required "url".');
      return null;
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      ctx.error(`Invalid url "${url}".`);
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      ctx.error(`Unsupported protocol "${parsed.protocol}"; use http or https.`);
      return null;
    }

    const service = readString(source, 'service');
    return {
      ...identity,
      url,
      expectStatus: readNumber(source, 'expectStatus', DEFAULTS.website.expectStatus, ctx, {
        min: 100,
        max: 599,
      }),
      timeoutMs: readNumber(source, 'timeoutMs', DEFAULTS.website.timeoutMs, ctx, {
        min: 500,
        max: 60000,
      }),
      // Certificate checks only mean something over TLS.
      checkCert:
        parsed.protocol === 'https:' &&
        readBoolean(source, 'checkCert', DEFAULTS.website.checkCert, ctx),
      ...(service ? { service } : {}),
    };
  });
}

export function normalizeCommands(raw: unknown, issues: ConfigIssue[]): RunCommandConfig[] {
  return normalizeEntries(raw, 'commands', issues, (source, identity, ctx) => {
    const command = readString(source, 'command');
    if (!command) {
      ctx.error('Missing required "command" (the executable to run).');
      return null;
    }
    // execFile never involves a shell, so metacharacters cannot be interpreted
    // — but a value containing them almost certainly means the author expected
    // a shell, so refuse it rather than silently running something surprising.
    if (/[;&|><`$(){}[\]\n]/.test(command)) {
      ctx.error(
        `"command" must be a single executable, not a shell line. ` +
          `Put arguments in "args" (got "${command}").`,
      );
      return null;
    }

    return {
      ...identity,
      command,
      args: readStringArray(source, 'args', ctx),
      allowArgs: readBoolean(source, 'allowArgs', DEFAULTS.command.allowArgs, ctx),
      sudo: readBoolean(source, 'sudo', DEFAULTS.command.sudo, ctx),
      confirm: readBoolean(source, 'confirm', DEFAULTS.command.confirm, ctx),
      timeoutMs: readNumber(source, 'timeoutMs', DEFAULTS.command.timeoutMs, ctx, {
        min: 1000,
        max: 120000,
      }),
    };
  });
}

export function normalizeFiles(raw: unknown, issues: ConfigIssue[]): FileTargetConfig[] {
  return normalizeEntries(raw, 'files', issues, (source, identity, ctx) => {
    const path = readString(source, 'path');
    if (!path) {
      ctx.error('Missing required "path".');
      return null;
    }
    // Absolute paths only: a relative path would resolve against the bot's
    // working directory, which is not something config authors can reason about.
    if (!isAbsolute(path)) {
      ctx.error(`"path" must be absolute (got "${path}").`);
      return null;
    }
    if (path.includes('..')) {
      ctx.error(`"path" must not contain ".." (got "${path}").`);
      return null;
    }

    return {
      ...identity,
      path,
      maxLines: readNumber(source, 'maxLines', DEFAULTS.file.maxLines, ctx, {
        min: 1,
        max: 1000,
      }),
    };
  });
}

export function normalizeMonitor(raw: unknown, issues: ConfigIssue[]): MonitorConfig {
  const ctx = new EntryContext('monitor', issues);
  const source = asRecord(raw) ?? {};
  const checks = asRecord(source['checks']) ?? {};
  const thresholds = asRecord(source['thresholds']) ?? {};
  const checksCtx = new EntryContext('monitor.checks', issues);
  const thresholdCtx = new EntryContext('monitor.thresholds', issues);
  const d = DEFAULTS.monitor;

  return {
    enabled: readBoolean(source, 'enabled', d.enabled, ctx),
    intervalSeconds: readNumber(source, 'intervalSeconds', d.intervalSeconds, ctx, {
      min: 10,
      max: 3600,
    }),
    alertCooldownMinutes: readNumber(
      source,
      'alertCooldownMinutes',
      d.alertCooldownMinutes,
      ctx,
      { min: 1, max: 1440 },
    ),
    checks: {
      resources: readBoolean(checks, 'resources', d.checks.resources, checksCtx),
      services: readBoolean(checks, 'services', d.checks.services, checksCtx),
      websites: readBoolean(checks, 'websites', d.checks.websites, checksCtx),
      certificates: readBoolean(checks, 'certificates', d.checks.certificates, checksCtx),
      failedUnits: readBoolean(checks, 'failedUnits', d.checks.failedUnits, checksCtx),
    },
    thresholds: {
      cpuPercent: readNumber(thresholds, 'cpuPercent', d.thresholds.cpuPercent, thresholdCtx, {
        min: 1,
        max: 100,
      }),
      memoryPercent: readNumber(
        thresholds,
        'memoryPercent',
        d.thresholds.memoryPercent,
        thresholdCtx,
        { min: 1, max: 100 },
      ),
      diskPercent: readNumber(
        thresholds,
        'diskPercent',
        d.thresholds.diskPercent,
        thresholdCtx,
        { min: 1, max: 100 },
      ),
      certExpiryDays: readNumber(
        thresholds,
        'certExpiryDays',
        d.thresholds.certExpiryDays,
        thresholdCtx,
        { min: 1, max: 365 },
      ),
      responseMs: readNumber(thresholds, 'responseMs', d.thresholds.responseMs, thresholdCtx, {
        min: 0,
        max: 60000,
      }),
      cpuTempCelsius: readNumber(
        thresholds,
        'cpuTempCelsius',
        d.thresholds.cpuTempCelsius,
        thresholdCtx,
        { min: 0, max: 150 },
      ),
    },
    ignoreMounts: readStringArray(source, 'ignoreMounts', ctx),
    historyHours: readNumber(source, 'historyHours', d.historyHours, ctx, {
      min: 1,
      max: 168,
    }),
  };
}

/** Warn about cross-section references that do not resolve. */
export function checkReferences(
  websites: WebsiteConfig[],
  services: ServiceConfig[],
  issues: ConfigIssue[],
): void {
  const serviceNames = new Set(services.map((service) => service.name.toLowerCase()));
  for (const site of websites) {
    if (site.service && !serviceNames.has(site.service.toLowerCase())) {
      issues.push({
        scope: `websites.${site.name}`,
        message: `Refers to unknown service "${site.service}"; the link is ignored.`,
        level: 'warning',
      });
    }
  }
}

/**
 * Command names the operator has switched off.
 *
 * Kept in config rather than as a flag on the command module: turning a
 * misbehaving command off should not need a build and a redeploy, which is
 * exactly the situation where you least want either.
 */
export function normalizeDisabledCommands(raw: unknown, issues: ConfigIssue[]): string[] {
  const ctx = new EntryContext('disabledCommands', issues);
  const names = readStringArray({ disabledCommands: raw }, 'disabledCommands', ctx);
  return names.map((name) => name.trim().toLowerCase()).filter(Boolean);
}
