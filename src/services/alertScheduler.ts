import type { Client, EmbedBuilder, SendableChannels } from 'discord.js';
import { config } from '../config.js';
import { childLogger } from '../logger.js';
import { getSnapshot } from './systemMonitor.js';
import { getAllStatuses } from './serviceManager.js';
import { checkAllSites } from './webMonitor.js';
import { warningEmbed, successEmbed } from '../lib/embeds.js';
import { formatPercent } from '../lib/format.js';

const log = childLogger('alertScheduler');

/**
 * Periodic health monitor. On each tick it evaluates host resources, managed
 * services and websites, then posts alerts to the configured alert channel.
 *
 * De-duplication: each distinct problem has a stable key. We only alert when a
 * key transitions from healthy -> unhealthy, and we send a recovery notice on
 * the reverse transition. A cooldown prevents re-alerting on a still-broken
 * condition too frequently. This keeps the channel signal-rich, not spammy.
 */
export class AlertScheduler {
  private readonly client: Client;
  /** key -> last alert timestamp (ms) */
  private readonly activeAlerts = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly cooldownMs: number;

  constructor(client: Client) {
    this.client = client;
    this.cooldownMs = config.monitor.alertCooldownMinutes * 60 * 1000;
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

  /** Run one full evaluation pass. */
  async tick(): Promise<void> {
    await Promise.all([this.checkResources(), this.checkServices(), this.checkWebsites()]);
  }

  private async checkResources(): Promise<void> {
    const snap = await getSnapshot();
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
      this.evaluate(
        `service:${status.service.name}`,
        !status.running,
        `Service down: ${status.service.label}`,
        `\`${status.service.unit}\` is **${status.activeState}** (${status.subState}).`,
      );
    }
  }

  private async checkWebsites(): Promise<void> {
    const results = await checkAllSites();
    for (const result of results) {
      this.evaluate(
        `website:${result.site.name}`,
        !result.up,
        `Website down: ${result.site.label}`,
        `${result.site.url}\n${result.error ?? 'Unreachable'}`,
      );
    }
  }

  /**
   * Core state-machine for a single monitored condition.
   * @param key    Stable identifier for this condition.
   * @param isBad  Whether the condition is currently unhealthy.
   * @param title  Alert title.
   * @param detail Alert body.
   */
  private evaluate(key: string, isBad: boolean, title: string, detail: string): void {
    const now = Date.now();
    const lastAlert = this.activeAlerts.get(key);

    if (isBad) {
      const isNew = lastAlert === undefined;
      const cooledDown = lastAlert !== undefined && now - lastAlert >= this.cooldownMs;
      if (isNew || cooledDown) {
        this.activeAlerts.set(key, now);
        this.send(warningEmbed(title, detail));
      }
    } else if (lastAlert !== undefined) {
      // Transitioned back to healthy — clear state and announce recovery.
      this.activeAlerts.delete(key);
      this.send(successEmbed(`Recovered: ${title}`, detail));
    }
  }

  /** Post an embed to the alert channel, tolerating a missing/invalid channel. */
  private send(embed: EmbedBuilder): void {
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
}

/** Extract a message string from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
