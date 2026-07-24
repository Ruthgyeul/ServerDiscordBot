import { config } from '../../config/index.js';
import type { SystemSnapshot } from '../host/systemMonitor.js';
import type { WebResult } from '../web/webMonitor.js';

/**
 * In-memory time series of everything the monitor already measures.
 *
 * The monitor loop visits each site and reads host metrics once per tick
 * anyway; keeping those samples turns single-point answers ("CPU is 62%")
 * into ones an operator can act on ("CPU is 62%, up from 31% an hour ago")
 * and gives the hosted sites a real uptime figure.
 *
 * Deliberately not persisted. The retention window is hours, samples are
 * cheap (a day at 60s is ~1440 entries), and a restart losing recent trend
 * data is a far smaller cost than owning a storage format, its migrations and
 * its failure modes. `/status` and `/sites` degrade to "not enough history
 * yet" rather than lying.
 */

export interface ResourceSample {
  at: number;
  cpuPercent: number;
  memPercent: number;
  /** Highest disk usage across all reported mounts. */
  maxDiskPercent: number;
}

export interface SiteSample {
  at: number;
  up: boolean;
  responseMs: number;
}

/** Movement of a metric between the start and end of a window. */
export interface Trend {
  /** Value at the far end of the window. */
  from: number;
  /** Most recent value. */
  to: number;
  delta: number;
  /** Age of the comparison point, in minutes. */
  spanMinutes: number;
}

export interface Availability {
  /** 0–100, share of samples where the site answered as expected. */
  uptimePercent: number;
  /** Mean response time across successful samples. */
  averageMs: number;
  samples: number;
  spanMinutes: number;
}

/** Ignore trends computed from a window shorter than this — too noisy to show. */
const MIN_TREND_MINUTES = 5;

class MetricsHistory {
  private readonly resources: ResourceSample[] = [];
  private readonly sites = new Map<string, SiteSample[]>();

  /** Record one host snapshot. Called from the monitor tick. */
  recordResources(snapshot: SystemSnapshot): void {
    const maxDiskPercent = snapshot.disks.reduce(
      (highest, disk) => Math.max(highest, disk.usePercent),
      0,
    );
    this.resources.push({
      at: Date.now(),
      cpuPercent: snapshot.cpuPercent,
      memPercent: snapshot.memPercent,
      maxDiskPercent,
    });
    prune(this.resources, this.retentionMs);
  }

  /** Record the outcome of one website check. */
  recordSite(result: WebResult): void {
    const samples = this.sites.get(result.site.name) ?? [];
    samples.push({ at: Date.now(), up: result.up, responseMs: result.responseMs });
    prune(samples, this.retentionMs);
    this.sites.set(result.site.name, samples);
  }

  /**
   * Compare the newest resource sample against the oldest one still inside
   * `windowMinutes`. Returns null until there is enough history to be useful.
   */
  getResourceTrend(
    metric: 'cpuPercent' | 'memPercent' | 'maxDiskPercent',
    windowMinutes = 60,
  ): Trend | null {
    const latest = this.resources.at(-1);
    if (!latest) return null;

    const cutoff = Date.now() - windowMinutes * 60_000;
    // The oldest sample inside the window is the fairest comparison point: it
    // is as far back as the caller asked for, or as far back as we have.
    const earliest = this.resources.find((sample) => sample.at >= cutoff) ?? this.resources[0];
    if (!earliest || earliest === latest) return null;

    const spanMinutes = Math.round((latest.at - earliest.at) / 60_000);
    if (spanMinutes < MIN_TREND_MINUTES) return null;

    return {
      from: earliest[metric],
      to: latest[metric],
      delta: latest[metric] - earliest[metric],
      spanMinutes,
    };
  }

  /** Uptime and mean latency for one site over the retained window. */
  getAvailability(siteName: string): Availability | null {
    const samples = this.sites.get(siteName);
    const first = samples?.[0];
    if (!samples || !first || samples.length < 2) return null;

    const upSamples = samples.filter((sample) => sample.up);
    const averageMs =
      upSamples.length > 0
        ? upSamples.reduce((total, sample) => total + sample.responseMs, 0) / upSamples.length
        : 0;

    return {
      uptimePercent: (upSamples.length / samples.length) * 100,
      averageMs,
      samples: samples.length,
      spanMinutes: Math.round((Date.now() - first.at) / 60_000),
    };
  }

  /** How many samples are held, for `/config show` and diagnostics. */
  get size(): { resources: number; sites: number } {
    let sites = 0;
    for (const samples of this.sites.values()) sites += samples.length;
    return { resources: this.resources.length, sites };
  }

  /** Drop everything — used when the inventory changes shape under us. */
  clear(): void {
    this.resources.length = 0;
    this.sites.clear();
  }

  private get retentionMs(): number {
    return config.monitor.historyHours * 3_600_000;
  }
}

/** Samples are appended in time order, so expiry is always a prefix. */
function prune(samples: { at: number }[], retentionMs: number): void {
  const cutoff = Date.now() - retentionMs;
  let expired = 0;
  while (expired < samples.length && (samples[expired]?.at ?? 0) < cutoff) expired += 1;
  if (expired > 0) samples.splice(0, expired);
}

/** Process-wide history, fed by the monitor loop. */
export const metricsHistory = new MetricsHistory();

/** Render a trend as a short, readable suffix, e.g. "↑ 12.4 pt in 60m". */
export function formatTrend(trend: Trend | null): string {
  if (!trend) return '';
  const arrow = trend.delta > 1 ? '↑' : trend.delta < -1 ? '↓' : '→';
  const magnitude = Math.abs(trend.delta);
  if (magnitude < 1) return ` ${arrow} steady over ${trend.spanMinutes}m`;
  return ` ${arrow} ${magnitude.toFixed(1)} pt in ${trend.spanMinutes}m`;
}
