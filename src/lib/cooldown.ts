/**
 * Per-user, per-command rate limiting.
 *
 * Every command here costs something on the managed host: a process-table
 * walk, an HTTP sweep of every site, a `systemctl show` per unit. Discord
 * makes it trivial to fire the same command repeatedly, and an impatient
 * double-click should not become two probes of a machine that is already
 * struggling — which is precisely when someone is most likely to be
 * double-clicking `/status`.
 *
 * Deliberately in-memory and per-process: this protects the host from
 * accidents, it is not a security control. Admins are still admins.
 */

/** `command:user` -> epoch ms when the cooldown expires. */
const expiries = new Map<string, number>();

/** Sweep expired entries once the map grows past this, so it cannot leak. */
const CLEANUP_THRESHOLD = 500;

export interface CooldownState {
  limited: boolean;
  /** Whole seconds left, for the message shown to the user. */
  secondsLeft: number;
}

/**
 * Check the cooldown for one user/command pair, and start a new one when the
 * call is allowed.
 *
 * @param seconds Cooldown length; 0 or less disables the check entirely.
 */
export function consumeCooldown(
  commandName: string,
  userId: string,
  seconds: number,
): CooldownState {
  if (seconds <= 0) return { limited: false, secondsLeft: 0 };

  const key = `${commandName}:${userId}`;
  const now = Date.now();
  const expiresAt = expiries.get(key);

  if (expiresAt !== undefined && expiresAt > now) {
    return { limited: true, secondsLeft: Math.ceil((expiresAt - now) / 1000) };
  }

  expiries.set(key, now + seconds * 1000);
  if (expiries.size > CLEANUP_THRESHOLD) sweep(now);

  return { limited: false, secondsLeft: 0 };
}

/** Drop entries that have already expired. */
function sweep(now: number): void {
  for (const [key, expiresAt] of expiries) {
    if (expiresAt <= now) expiries.delete(key);
  }
}

/** Clear all cooldowns. Used by tests and after a config reload. */
export function resetCooldowns(): void {
  expiries.clear();
}
