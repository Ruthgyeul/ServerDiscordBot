import { run } from '../lib/shell.js';
import { findService, config } from '../config.js';
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

/**
 * Whether to prefix systemctl with `sudo -n`. Enable when the bot runs as a
 * non-root user that has a narrowly-scoped sudoers rule (see README). When the
 * unit files are user units or the bot runs as root, leave this off.
 */
const USE_SUDO = process.env.SYSTEMCTL_SUDO === 'true';

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

/** Build the argv for a systemctl invocation, resolving sudo prefixing. */
function buildInvocation(systemctlArgs: string[]): { file: string; args: string[] } {
  if (USE_SUDO) {
    return { file: 'sudo', args: ['-n', 'systemctl', ...systemctlArgs] };
  }
  return { file: 'systemctl', args: systemctlArgs };
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
  const { file, args } = buildInvocation([action, service.unit]);

  log.info({ service: service.name, unit: service.unit, action }, 'systemctl action');

  const { stdout, stderr } = await run(file, args, {
    // Read-only status calls exit non-zero when a unit is inactive; we handle
    // that in getStatus. For mutating calls, a longer timeout accommodates
    // services that are slow to stop/start.
    timeoutMs: isMutating ? 30000 : 15000,
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
  const { file, args } = buildInvocation([
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

/** Read the last N journal lines for a managed service via `journalctl`. */
export async function getLogs(name: string, lines = 30): Promise<string> {
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
  const { file, args } = USE_SUDO
    ? { file: 'sudo', args: ['-n', 'journalctl', ...journalArgs] }
    : { file: 'journalctl', args: journalArgs };

  const { stdout } = await run(file, args);
  return stdout.trim() || '(no log output)';
}
