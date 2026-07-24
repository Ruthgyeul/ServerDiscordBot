import { config } from '../config.js';

/**
 * Lightweight HTTP health checker for the websites hosted on this server.
 * Uses the global `fetch` (Node >= 18) with an AbortController timeout so a
 * hung endpoint can never stall the monitor loop.
 */

/**
 * @typedef {object} WebResult
 * @property {object} site        The configured website entry.
 * @property {boolean} up         Whether the check passed.
 * @property {number | null} status  HTTP status code, or null on network error.
 * @property {number} responseMs  Round-trip time in milliseconds.
 * @property {string | null} error   Error message when the check failed.
 */

/**
 * Perform a single health check against one configured website.
 * @param {object} site - Entry from config.websites.
 * @returns {Promise<WebResult>}
 */
export async function checkSite(site) {
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
  } catch (error) {
    const responseMs = Math.round(performance.now() - start);
    const reason =
      error.name === 'AbortError' ? `Timed out after ${timeout}ms` : error.message;
    return { site, up: false, status: null, responseMs, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check every configured website concurrently.
 * @returns {Promise<WebResult[]>}
 */
export async function checkAllSites() {
  return Promise.all(config.websites.map((site) => checkSite(site)));
}
