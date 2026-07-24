/**
 * Formatting helpers for human-readable output in Discord embeds.
 */

/** Convert a byte count into a human-friendly string (e.g. "3.2 GB"). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/** Format a duration given in seconds as "3d 4h 12m". */
export function formatDuration(seconds: number): string {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

/** Format a percentage with one decimal and a trailing sign. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Build a simple text progress bar, e.g. "██████░░░░ 60%". */
export function progressBar(percent: number, size = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${formatPercent(clamped)}`;
}

/** Truncate text to fit inside a Discord code block / field value. */
export function truncate(text: string, max = 1900): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
