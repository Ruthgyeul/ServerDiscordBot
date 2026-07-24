import { config } from '../config.js';
import type { WebsiteConfig } from '../types.js';

/**
 * Lightweight HTTP health checker for the websites hosted on this server.
 * Uses the global `fetch` (Node >= 18) with an AbortController timeout so a
 * hung endpoint can never stall the monitor loop.
 */

export interface WebResult {
  site: WebsiteConfig;
  up: boolean;
  status: number | null;
  responseMs: number;
  error: string | null;
}

/** Perform a single health check against one configured website. */
export async function checkSite(site: WebsiteConfig): Promise<WebResult> {
  const timeout = site.timeoutMs ?? 8000;
  const expected = site.expectStatus ?? 200;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const start = performance.now();

  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': `${config.bot.name}/1.0 health-check` },
    });
    const responseMs = Math.round(performance.now() - start);
    const up = res.status === expected;
    return {
      site,
      up,
      status: res.status,
      responseMs,
      error: up ? null : `Expected ${expected}, got ${res.status}`,
    };
  } catch (rawError) {
    const responseMs = Math.round(performance.now() - start);
    const error = rawError as Error;
    const reason =
      error.name === 'AbortError' ? `Timed out after ${timeout}ms` : error.message;
    return { site, up: false, status: null, responseMs, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Check every configured website concurrently. */
export async function checkAllSites(): Promise<WebResult[]> {
  return Promise.all(config.websites.map((site) => checkSite(site)));
}
