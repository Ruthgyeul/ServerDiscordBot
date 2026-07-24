import dotenv from 'dotenv';
import type { ConfigIssue } from '../types.js';

/**
 * Typed, forgiving readers for environment variables.
 *
 * Every reader takes a fallback and records a warning instead of throwing when
 * a value is malformed, so one typo in `.env` can never stop the bot from
 * booting. Collected issues are surfaced by `/config show` and logged at start.
 * Values that genuinely must be present (the Discord token) are enforced
 * separately in `assertBootConfig`.
 */

/** (Re-)read `.env` into `process.env`. `override` is used when hot-reloading. */
export function loadDotenv(override = false): void {
  dotenv.config({ override });
}

/** A reader bound to an issue list, so callers do not thread it through. */
export class EnvReader {
  private readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    this.issues = issues;
  }

  private warn(key: string, message: string): void {
    this.issues.push({ scope: `env.${key}`, message, level: 'warning' });
  }

  /** Raw string, trimmed. Empty / unset yields the fallback. */
  string(key: string, fallback = ''): string {
    const raw = process.env[key]?.trim();
    return raw ? raw : fallback;
  }

  /** Integer with optional bounds; out-of-range or non-numeric warns. */
  int(
    key: string,
    fallback: number,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER,
  ): number {
    const raw = process.env[key]?.trim();
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value)) {
      this.warn(key, `"${raw}" is not a number; using ${fallback}.`);
      return fallback;
    }
    const rounded = Math.round(value);
    if (rounded < min || rounded > max) {
      this.warn(key, `${rounded} is outside ${min}–${max}; using ${fallback}.`);
      return fallback;
    }
    return rounded;
  }

  /** Boolean accepting true/false, 1/0, yes/no, on/off (case-insensitive). */
  bool(key: string, fallback: boolean): boolean {
    const raw = process.env[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (['true', '1', 'yes', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'off'].includes(raw)) return false;
    this.warn(key, `"${raw}" is not a boolean; using ${fallback}.`);
    return fallback;
  }

  /** Comma-separated list, trimmed, empty entries dropped. */
  list(key: string): string[] {
    const raw = process.env[key];
    if (!raw) return [];
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  /** One of a fixed set of values (case-insensitive). */
  enum<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const raw = process.env[key]?.trim().toLowerCase();
    if (!raw) return fallback;

    const match = allowed.find((option) => option.toLowerCase() === raw);
    if (match) return match;

    this.warn(key, `"${raw}" is not one of ${allowed.join(' | ')}; using ${fallback}.`);
    return fallback;
  }

  /** Hex color (`#5865F2`, `5865F2`) as a 24-bit integer. */
  color(key: string, fallback: number): number {
    const raw = process.env[key]?.trim().replace(/^#/, '');
    if (!raw) return fallback;

    if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
      this.warn(key, `"${raw}" is not a 6-digit hex color; using the default.`);
      return fallback;
    }
    return Number.parseInt(raw, 16);
  }
}
