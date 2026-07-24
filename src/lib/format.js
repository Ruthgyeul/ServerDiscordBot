/**
 * Formatting helpers for human-readable output in Discord embeds.
 */

/**
 * Convert a byte count into a human-friendly string (e.g. "3.2 GB").
 * @param {number} bytes
 * @param {number} [decimals=1]
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * Format a duration given in seconds as "3d 4h 12m".
 * @param {number} seconds
 */
export function formatDuration(seconds) {
  const s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

/**
 * Format a percentage with one decimal and a trailing sign.
 * @param {number} value
 */
export function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

/**
 * Build a simple text progress bar, e.g. "██████░░░░ 60%".
 * @param {number} percent - 0..100
 * @param {number} [size=10]
 */
export function progressBar(percent, size = 10) {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)} ${formatPercent(clamped)}`;
}

/**
 * Truncate text to fit inside a Discord code block / field value.
 * @param {string} text
 * @param {number} [max=1900]
 */
export function truncate(text, max = 1900) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
