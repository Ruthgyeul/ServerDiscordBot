import { run } from '../lib/shell.js';
import { findService, config } from '../config/index.js';
import { childLogger } from '../logger.js';
import type { ServiceConfig } from '../types.js';

const log = childLogger('serviceManager');

/**
 * Actions that may be performed on a managed systemd unit.
 * `start`, `stop` and `restart` change state and are privileged.
 * `status` is read-only.
 */
export enum ServiceAction {
  START = 'start',
  STOP = 'stop',
  RESTART = 'restart',
  STATUS = 'status',
}

const MUTATING_ACTIONS = new Set<ServiceAction>([
  ServiceAction.START,
  ServiceAction.STOP,
  ServiceAction.RESTART,
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
  since: string | null;
  error?: string;
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

  const props = 'ActiveState,SubState,LoadState,ActiveEnterTimestamp';
  const { file, args } = buildInvocation('systemctl', [
    'show',
    service.unit,
    `--property=${props}`,
    '--no-page',
  ]);

  const { stdout } = await run(file, args);
  const parsed = parseKeyValue(stdout);

  return {
    service,
    activeState: parsed.ActiveState ?? 'unknown',
    subState: parsed.SubState ?? 'unknown',
    loadState: parsed.LoadState ?? 'unknown',
    running: parsed.ActiveState === 'active',
    since: parsed.ActiveEnterTimestamp || null,
  };
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
          since: null,
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
