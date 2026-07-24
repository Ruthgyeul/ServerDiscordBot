import type { Client, EmbedBuilder, SendableChannels } from 'discord.js';
import { config } from '../../config/index.js';
import { childLogger } from '../../logger.js';
import { getSnapshot } from '../host/systemMonitor.js';
import { getAllStatuses, getFailedUnits } from '../host/serviceManager.js';
import { checkAllSites } from '../web/webMonitor.js';
import { warningEmbed, successEmbed } from '../../lib/embeds.js';
import { metricsHistory } from './metricsHistory.js';
import { formatPercent } from '../../lib/format.js';

const log = childLogger('alertScheduler');

/** How many transitions to remember for `/alerts history`. */
const MAX_EVENTS = 100;

/** A state change the monitor observed, kept for `/alerts history`. */
export interface AlertEvent {
  at: number;
  key: string;
  title: string;
  kind: 'fired' | 'recovered';
}

/** One condition currently considered unhealthy. */
export interface ActiveAlert {
  key: string;
  title: string;
  detail: string;
  /** When the condition first went bad. */
  since: number;
  /** When we last posted about it. */
  lastNotified: number;
}

/**
 * Periodic health monitor. On each tick it evaluates host resources, managed
 * services, websites and TLS certificates, then posts alerts to the configured
 * alert channel.
 *
 * De-duplication: each distinct problem has a stable key. We only alert when a
 * key transitions from healthy -> unhealthy, and we send a recovery notice on
 * the reverse transition. A cooldown prevents re-alerting on a still-broken
 * condition too frequently. This keeps the channel signal-rich, not spammy.
 *
 * Every knob it reads — the interval, the thresholds, which passes run at all —
 * is read from `config` per tick, so a `/config reload` retunes the monitor
 * live. Only a changed *interval* needs the loop restarted, which `restart()`
 * handles.
 */
export class AlertScheduler {
  private readonly client: Client;
  private readonly activeAlerts = new Map<string, ActiveAlert>();
  /**
   * Recent transitions, newest last. Bounded because this is a debugging aid,
   * not a record of truth — the channel and the journal are that.
   */
  private readonly events: AlertEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Epoch ms until which alerts are suppressed; null when not muted. */
  private mutedUntil: number | null = null;

  constructor(client: Client) {
    this.client = client;
  }

  /** Start the recurring monitor loop (no-op if disabled in config). */
  start(): void {
    if (!config.monitor.enabled) {
      log.info('Monitoring disabled in config; scheduler not started.');
      return;
    }
    if (!config.discord.alertChannelId) {
      log.warn('ALERT_CHANNEL_ID not set; monitoring runs but cannot post alerts.');
    }

    const intervalMs = config.monitor.intervalSeconds * 1000;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) =>
        log.error({ err: errorMessage(err) }, 'monitor tick failed'),
      );
    }, intervalMs);
    // Do not keep the event loop alive solely for the timer.
    this.timer.unref?.();

    log.info({ intervalSeconds: config.monitor.intervalSeconds }, 'monitor started');
  }

  /** Stop the monitor loop. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-read the interval and enabled flag from config; used after a reload. */
  restart(): void {
    this.stop();
    this.start();
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /**
   * Run one full evaluation pass, honouring the per-check toggles.
   *
   * The checks are independent and are settled independently: `Promise.all`
   * would let one failure — a missing `systemctl`, a transient permission
   * error — discard the results of every other check in the same tick, so a
   * single broken probe would silently switch off website monitoring too. Each
   * failure is logged against its own check and the rest still report.
   */
  async tick(): Promise<void> {
    const { checks } = config.monitor;

    const passes: [string, boolean, () => Promise<void>][] = [
      ['resources', checks.resources, () => this.checkResources()],
      ['services', checks.services, () => this.checkServices()],
      ['websites', checks.websites || checks.certificates, () => this.checkWebsites()],
      ['failedUnits', checks.failedUnits, () => this.checkFailedUnits()],
    ];

    const enabled = passes.filter(([, on]) => on);
    const results = await Promise.allSettled(enabled.map(([, , runPass]) => runPass()));

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        log.error(
          { check: enabled[index]?.[0], err: errorMessage(result.reason) },
          'monitor check failed',
        );
      }
    });
  }

  /* ── Alert state, inspectable from /alerts ─────────────────────────────── */

  /** Every condition currently unhealthy, newest problem first. */
  getActiveAlerts(): ActiveAlert[] {
    return [...this.activeAlerts.values()].sort((a, b) => b.since - a.since);
  }

  /**
   * Recent fired/recovered transitions, newest first.
   *
   * Answers the question `/alerts state` cannot: something broke and fixed
   * itself while nobody was looking — how often, and how long did it last?
   */
  getRecentEvents(limit = 15): AlertEvent[] {
    return [...this.events].reverse().slice(0, limit);
  }

  /** Suppress outgoing alerts for a while (maintenance windows, noisy deploys). */
  mute(minutes: number): Date {
    this.mutedUntil = Date.now() + minutes * 60 * 1000;
    log.info({ minutes }, 'alerts muted');
    return new Date(this.mutedUntil);
  }

  unmute(): void {
    this.mutedUntil = null;
    log.info('alerts unmuted');
  }

  /** When muted, the moment alerts resume; null otherwise. */
  get muteExpiry(): Date | null {
    if (this.mutedUntil === null) return null;
    if (Date.now() >= this.mutedUntil) {
      this.mutedUntil = null;
      return null;
    }
    return new Date(this.mutedUntil);
  }

  /* ── Individual checks ─────────────────────────────────────────────────── */

  private async checkResources(): Promise<void> {
    const snap = await getSnapshot();
    metricsHistory.recordResources(snap);
    const t = config.monitor.thresholds;

    this.evaluate(
      'cpu',
      snap.cpuPercent >= t.cpuPercent,
      'High CPU usage',
      `CPU load is ${formatPercent(snap.cpuPercent)} (threshold ${t.cpuPercent}%).`,
    );

    this.evaluate(
      'memory',
      snap.memPercent >= t.memoryPercent,
      'High memory usage',
      `Memory usage is ${formatPercent(snap.memPercent)} (threshold ${t.memoryPercent}%).`,
    );

    if (snap.cpuTempC !== null && t.cpuTempCelsius > 0) {
      this.evaluate(
        'cpu-temp',
        snap.cpuTempC >= t.cpuTempCelsius,
        'High CPU temperature',
        `CPU is at ${snap.cpuTempC.toFixed(1)} °C (threshold ${t.cpuTempCelsius} °C).`,
      );
    }

    for (const disk of snap.disks) {
      this.evaluate(
        `disk:${disk.mount}`,
        disk.usePercent >= t.diskPercent,
        `Low disk space on ${disk.mount}`,
        `Disk ${disk.mount} is ${formatPercent(disk.usePercent)} full (threshold ${t.diskPercent}%).`,
      );
    }
  }

  private async checkServices(): Promise<void> {
    const statuses = await getAllStatuses();
    for (const status of statuses) {
      const mark = status.service.critical ? '❗ ' : '';
      this.evaluate(
        `service:${status.service.name}`,
        !status.running,
        `${mark}Service down: ${status.service.label}`,
        `\`${status.service.unit}\` is **${status.activeState}** (${status.subState}).`,
      );
    }
  }

  /**
   * Watch for failed units the allowlist does not cover.
   *
   * Opt-in (`checks.failedUnits`), because on a busy host this can fire for
   * units the operator neither owns nor cares about. When it is on, a single
   * alert names them all rather than one alert per unit — the useful signal is
   * "something on this box is failing", not a per-unit stream.
   */
  private async checkFailedUnits(): Promise<void> {
    const failed = await getFailedUnits();
    const names = failed.map((unit) => unit.unit).sort();

    this.evaluate(
      'failed-units',
      names.length > 0,
      `${names.length} failed systemd unit(s)`,
      names.map((name) => `\`${name}\``).join(', '),
    );
  }

  /**
   * Websites and their certificates share one pass: both come from the same
   * check, so doing them together halves the requests to each site.
   */
  private async checkWebsites(): Promise<void> {
    const { checks, thresholds } = config.monitor;
    const results = await checkAllSites(checks.certificates);

    for (const result of results) {
      metricsHistory.recordSite(result);

      if (checks.websites) {
        this.evaluate(
          `website:${result.site.name}`,
          !result.up,
          `Website down: ${result.site.label}`,
          `${result.site.url}\n${result.error ?? 'Unreachable'}`,
        );

        this.evaluate(
          `website-slow:${result.site.name}`,
          result.slow,
          `Website slow: ${result.site.label}`,
          `Responded in ${result.responseMs} ms (threshold ${thresholds.responseMs} ms).`,
        );
      }

      if (checks.certificates && result.site.checkCert) {
        this.evaluateCertificate(result.site.name, result.site.label, result);
      }
    }
  }

  private evaluateCertificate(
    name: string,
    label: string,
    result: { cert: { daysRemaining: number; validTo: Date; issuer: string } | null },
  ): void {
    const cert = result.cert;
    // No cert data means the site itself is unreachable — already alerted on.
    if (!cert) return;

    const limit = config.monitor.thresholds.certExpiryDays;
    const expired = cert.daysRemaining < 0;
    this.evaluate(
      `cert:${name}`,
      cert.daysRemaining <= limit,
      expired
        ? `TLS certificate EXPIRED: ${label}`
        : `TLS certificate expiring soon: ${label}`,
      `Expires ${cert.validTo.toISOString().slice(0, 10)} ` +
        `(${cert.daysRemaining} days, threshold ${limit}) · issued by ${cert.issuer}.`,
    );
  }

  /**
   * Core state-machine for a single monitored condition.
   *
   * @param key    Stable identifier for this condition.
   * @param isBad  Whether the condition is currently unhealthy.
   * @param title  Alert title.
   * @param detail Alert body.
   */
  private evaluate(key: string, isBad: boolean, title: string, detail: string): void {
    const now = Date.now();
    const existing = this.activeAlerts.get(key);
    const cooldownMs = config.monitor.alertCooldownMinutes * 60 * 1000;

    if (isBad) {
      if (!existing) {
        this.activeAlerts.set(key, { key, title, detail, since: now, lastNotified: now });
        this.record({ at: now, key, title, kind: 'fired' });
        this.send(warningEmbed(title, detail));
        return;
      }

      // Still bad: refresh the detail, but only re-post once cooled down.
      existing.detail = detail;
      if (now - existing.lastNotified >= cooldownMs) {
        existing.lastNotified = now;
        this.send(warningEmbed(title, detail));
      }
    } else if (existing) {
      // Transitioned back to healthy — clear state and announce recovery.
      this.activeAlerts.delete(key);
      this.record({ at: now, key, title, kind: 'recovered' });
      this.send(successEmbed(`Recovered: ${title}`, detail));
    }
  }

  /** Append a transition, dropping the oldest once the buffer is full. */
  private record(event: AlertEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }

  /** Post an embed to the alert channel, tolerating a missing/invalid channel. */
  private send(embed: EmbedBuilder): void {
    if (this.muteExpiry) return;

    const channelId = config.discord.alertChannelId;
    if (!channelId) return;

    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.isTextBased() || !channel.isSendable()) {
      log.warn({ channelId }, 'alert channel not found or not sendable');
      return;
    }
    (channel as SendableChannels).send({ embeds: [embed] }).catch((err: unknown) => {
      log.error({ err: errorMessage(err) }, 'failed to send alert');
    });
  }

  /** Send an arbitrary embed to the alert channel, bypassing the mute. */
  sendDirect(embed: EmbedBuilder): void {
    const previousMute = this.mutedUntil;
    this.mutedUntil = null;
    this.send(embed);
    this.mutedUntil = previousMute;
  }
}

/** Extract a message string from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
