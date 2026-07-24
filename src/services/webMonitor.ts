import { config } from '../config/index.js';
import { checkCertificate, type CertInfo } from './certMonitor.js';
import type { WebsiteConfig } from '../types.js';

/**
 * Lightweight HTTP health checker for the websites hosted on this server.
 * Uses the global `fetch` (Node >= 18) with an AbortController timeout so a
 * hung endpoint can never stall the monitor loop.
 *
 * A site is "up" when it answers with the status its config expects. Response
 * time and certificate expiry are reported alongside, so a site that is
 * technically up but degraded (slow, or about to lose its certificate) is
 * still visible before it becomes an outage.
 */

export interface WebResult {
  site: WebsiteConfig;
  up: boolean;
  status: number | null;
  responseMs: number;
  error: string | null;
  /** Present when the site is https and `checkCert` is enabled. */
  cert: CertInfo | null;
  certError: string | null;
  /** True when `monitor.thresholds.responseMs` is set and was exceeded. */
  slow: boolean;
}

/**
 * Perform a single health check against one configured website.
 *
 * @param withCert Inspect the TLS certificate too. Skipped for ad-hoc checks
 *                 that only care about reachability.
 */
export async function checkSite(site: WebsiteConfig, withCert = true): Promise<WebResult> {
  const [http, cert] = await Promise.all([
    checkHttp(site),
    withCert && site.checkCert
      ? checkCertificate(site.url, site.timeoutMs)
      : Promise.resolve(null),
  ]);

  const slowThreshold = config.monitor.thresholds.responseMs;
  return {
    ...http,
    cert: cert?.info ?? null,
    certError: cert?.error ?? null,
    slow: http.up && slowThreshold > 0 && http.responseMs > slowThreshold,
  };
}

type HttpResult = Pick<WebResult, 'site' | 'up' | 'status' | 'responseMs' | 'error'>;

async function checkHttp(site: WebsiteConfig): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), site.timeoutMs);
  const start = performance.now();

  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': `${config.bot.name}/1.0 health-check` },
    });
    const responseMs = Math.round(performance.now() - start);
    const up = res.status === site.expectStatus;
    return {
      site,
      up,
      status: res.status,
      responseMs,
      error: up ? null : `Expected ${site.expectStatus}, got ${res.status}`,
    };
  } catch (rawError) {
    const responseMs = Math.round(performance.now() - start);
    const error = rawError as Error;
    const reason =
      error.name === 'AbortError' ? `Timed out after ${site.timeoutMs}ms` : error.message;
    return { site, up: false, status: null, responseMs, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Check every configured website concurrently. */
export async function checkAllSites(withCert = true): Promise<WebResult[]> {
  return Promise.all(config.websites.map((site) => checkSite(site, withCert)));
}
