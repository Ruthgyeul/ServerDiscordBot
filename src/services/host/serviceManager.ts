import { run } from '../../lib/shell.js';
import { findService, config } from '../../config/index.js';
import { childLogger } from '../../logger.js';
import type { ServiceConfig } from '../../types/index.js';

const log = childLogger('serviceManager');

/**
 * Actions that may be performed on a managed systemd unit.
 *
 * `start`, `stop` and `restart` change the unit's *current* state; `enable`
 * and `disable` change whether it comes back after a reboot. Both are
 * privileged and both are mutating — a service that is running but disabled is
 * a machine that comes up broken, which is worth being able to see and fix
 * from the same place.
 */
export enum ServiceAction {
  START = 'start',
  STOP = 'stop',
  RESTART = 'restart',
  ENABLE = 'enable',
  DISABLE = 'disable',
  STATUS = 'status',
}

const MUTATING_ACTIONS = new Set<ServiceAction>([
  ServiceAction.START,
  ServiceAction.STOP,
  ServiceAction.RESTART,
  ServiceAction.ENABLE,
  ServiceAction.DISABLE,
]);

export interface ControlResult {
  service: ServiceConfig;
  action: ServiceAction;
  output: string;
}

export interface ServiceStatus {
  service: ServiceConfig;
  activeState: string;
  subState: string;
  loadState: string;
  running: boolean;
  /** Whether the unit is wired to start at boot. */
  enabled: boolean;
  /** Raw UnitFileState, e.g. "enabled", "disabled", "static", "masked". */
  unitFileState: string;
  since: string | null;
  /** Times systemd has restarted the unit — a flapping service shows up here. */
  restarts: number;
  error?: string;
}

/** A failed unit on the host, including ones outside the managed allowlist. */
export interface FailedUnit {
  unit: string;
  activeState: string;
  subState: string;
  description: string;
  /** True when this unit is one the bot manages. */
  managed: boolean;
}

/**
 * Build the argv for a systemctl/journalctl invocation.
 *
 * Both host-access decisions live in config (`SYSTEMCTL_SUDO`,
 * `SYSTEMCTL_SCOPE`) and are read per call, so switching between root, a
 * sudoers-scoped bot user, or `--user` units is an `.env` change:
 *
 *   sudo -n systemctl --user <args>
 */
function buildInvocation(
  tool: 'systemctl' | 'journalctl',
  toolArgs: string[],
): {
  file: string;
  args: string[];
} {
  const scoped = config.system.scope === 'user' ? ['--user', ...toolArgs] : toolArgs;
  if (config.system.useSudo) {
    return { file: 'sudo', args: ['-n', tool, ...scoped] };
  }
  return { file: tool, args: scoped };
}

/**
 * Perform an action on a managed service.
 *
 * The service MUST exist in config (the allowlist). We never pass an arbitrary
 * unit name to systemctl — only the pre-approved `unit` string from config —
 * which is what makes remote service control safe to expose over Discord.
 */
export async function controlService(
  name: string,
  action: ServiceAction,
): Promise<ControlResult> {
  const service = findService(name);
  if (!service) {
    throw new Error(`Unknown service "${name}". Not in the managed allowlist.`);
  }
  if (!Object.values(ServiceAction).includes(action)) {
    throw new Error(`Invalid action "${action}".`);
  }

  const isMutating = MUTATING_ACTIONS.has(action);
  const { file, args } = buildInvocation('systemctl', [action, service.unit]);

  log.info({ service: service.name, unit: service.unit, action }, 'systemctl action');

  const { stdout, stderr } = await run(file, args, {
    // Read-only status calls exit non-zero when a unit is inactive; we handle
    // that in getStatus. For mutating calls, a longer timeout accommodates
    // services that are slow to stop/start.
    timeoutMs: isMutating
      ? config.system.commandTimeoutMs * 2
      : config.system.commandTimeoutMs,
  });

  return { service, action, output: (stdout + stderr).trim() };
}

/**
 * Get a compact status object for a managed service using `systemctl show`,
 * which is script-friendly (key=value) and never fails just because a unit is
 * inactive.
 */
export async function getStatus(name: string): Promise<ServiceStatus> {
  const service = findService(name);
  if (!service) {
    throw new Error(`Unknown service "${name}". Not in the managed allowlist.`);
  }

  const props = 'ActiveState,SubState,LoadState,ActiveEnterTimestamp,UnitFileState,NRestarts';
  const { file, args } = buildInvocation('systemctl', [
    'show',
    service.unit,
    `--property=${props}`,
    '--no-page',
  ]);

  const { stdout } = await run(file, args);
  const parsed = parseKeyValue(stdout);

  const unitFileState = parsed.UnitFileState ?? 'unknown';
  return {
    service,
    activeState: parsed.ActiveState ?? 'unknown',
    subState: parsed.SubState ?? 'unknown',
    loadState: parsed.LoadState ?? 'unknown',
    running: parsed.ActiveState === 'active',
    // "enabled-runtime" also survives to the next boot; "static" units have no
    // install section and are pulled in by something else, so neither counts
    // as an operator-visible problem.
    enabled: unitFileState.startsWith('enabled') || unitFileState === 'static',
    unitFileState,
    since: parsed.ActiveEnterTimestamp || null,
    restarts: Number(parsed.NRestarts ?? 0) || 0,
  };
}

/**
 * Every unit the host currently considers failed.
 *
 * Deliberately not limited to the allowlist: the allowlist says what the bot
 * may *control*, while this answers "is anything on this machine broken?" —
 * including the unit someone added last week and forgot to register. It is
 * read-only, so widening the view costs nothing.
 */
export async function getFailedUnits(): Promise<FailedUnit[]> {
  const { file, args } = buildInvocation('systemctl', [
    'list-units',
    '--failed',
    '--all',
    '--no-legend',
    '--no-pager',
    '--plain',
  ]);

  const { stdout } = await run(file, args);
  const managed = new Set(config.services.map((service) => service.unit));

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // UNIT LOAD ACTIVE SUB DESCRIPTION…
      const [unit = '', , activeState = '', subState = '', ...rest] = line.split(/\s+/);
      return {
        unit,
        activeState,
        subState,
        description: rest.join(' '),
        managed: managed.has(unit),
      };
    })
    .filter((entry) => entry.unit.length > 0);
}

/** Fetch the status of every managed service concurrently. */
export async function getAllStatuses(): Promise<ServiceStatus[]> {
  return Promise.all(
    config.services.map(async (service): Promise<ServiceStatus> => {
      try {
        return await getStatus(service.name);
      } catch (rawError) {
        const message = rawError instanceof Error ? rawError.message : String(rawError);
        log.warn({ service: service.name, err: message }, 'status lookup failed');
        return {
          service,
          running: false,
          activeState: 'error',
          subState: message,
          loadState: 'error',
          enabled: false,
          unitFileState: 'unknown',
          since: null,
          restarts: 0,
          error: message,
        };
      }
    }),
  );
}

/** Parse `key=value` lines (as emitted by `systemctl show`) into an object. */
function parseKeyValue(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Read the last N journal lines for a managed service via `journalctl`.
 *
 * @param lines    Line count, clamped to 1–100 so a reply always fits Discord.
 * @param priority Optional syslog priority ceiling (e.g. "err" for errors only).
 */
export async function getLogs(name: string, lines = 30, priority?: string): Promise<string> {
  const service = findService(name);
  if (!service) {
    throw new Error(`Unknown service "${name}". Not in the managed allowlist.`);
  }

  const safeLines = Math.max(1, Math.min(100, Math.floor(lines)));
  const journalArgs = [
    '-u',
    service.unit,
    '-n',
    String(safeLines),
    '--no-pager',
    '--output',
    'short-iso',
  ];
  if (priority) journalArgs.push('--priority', priority);

  const { file, args } = buildInvocation('journalctl', journalArgs);
  const { stdout } = await run(file, args);
  return stdout.trim() || '(no log output)';
}
