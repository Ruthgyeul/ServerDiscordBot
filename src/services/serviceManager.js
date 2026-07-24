import { run } from '../lib/shell.js';
import { findService, config } from '../config.js';
import { childLogger } from '../logger.js';

const log = childLogger('serviceManager');

/**
 * Actions that may be performed on a managed systemd unit.
 * `start`, `stop` and `restart` change state and are privileged.
 * `status` is read-only.
 * @readonly
 */
export const ServiceAction = Object.freeze({
  START: 'start',
  STOP: 'stop',
  RESTART: 'restart',
  STATUS: 'status',
});

const MUTATING_ACTIONS = new Set([
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

/**
 * Build the argv for a systemctl invocation, resolving sudo prefixing.
 * @param {string[]} systemctlArgs
 * @returns {{ file: string, args: string[] }}
 */
function buildInvocation(systemctlArgs) {
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
 *
 * @param {string} name - Short service name from config.
 * @param {string} action - A {@link ServiceAction} value.
 * @returns {Promise<{ service: object, action: string, output: string }>}
 */
export async function controlService(name, action) {
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
 * Get a compact status object for a managed service using
 * `systemctl show`, which is script-friendly (key=value) and never fails
 * just because a unit is inactive.
 *
 * @param {string} name - Short service name from config.
 * @returns {Promise<{
 *   service: object,
 *   activeState: string,
 *   subState: string,
 *   loadState: string,
 *   running: boolean,
 *   since: string | null,
 * }>}
 */
export async function getStatus(name) {
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

/**
 * Fetch the status of every managed service concurrently.
 * @returns {Promise<Array<{ service: object, running: boolean, activeState: string, subState: string, error?: string }>>}
 */
export async function getAllStatuses() {
  return Promise.all(
    config.services.map(async (service) => {
      try {
        const status = await getStatus(service.name);
        return status;
      } catch (error) {
        log.warn({ service: service.name, err: error.message }, 'status lookup failed');
        return {
          service,
          running: false,
          activeState: 'error',
          subState: error.message,
          error: error.message,
        };
      }
    }),
  );
}

/**
 * Parse `key=value` lines (as emitted by `systemctl show`) into an object.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseKeyValue(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx)] = line.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Read the last N journal lines for a managed service via `journalctl`.
 * @param {string} name - Short service name from config.
 * @param {number} [lines=30]
 * @returns {Promise<string>}
 */
export async function getLogs(name, lines = 30) {
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
