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
  /**
   * @param {import('discord.js').Client} client
   */
  constructor(client) {
    this.client = client;
    /** @type {Map<string, number>} key -> last alert timestamp (ms) */
    this.activeAlerts = new Map();
    this.timer = null;
    this.cooldownMs = config.monitor.alertCooldownMinutes * 60 * 1000;
  }

  /** Start the recurring monitor loop (no-op if disabled in config). */
  start() {
    if (!config.monitor.enabled) {
      log.info('Monitoring disabled in config; scheduler not started.');
      return;
    }
    if (!config.discord.alertChannelId) {
      log.warn('ALERT_CHANNEL_ID not set; monitoring runs but cannot post alerts.');
    }

    const intervalMs = config.monitor.intervalSeconds * 1000;
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error({ err: err.message }, 'monitor tick failed'));
    }, intervalMs);
    // Do not keep the event loop alive solely for the timer.
    this.timer.unref?.();

    log.info({ intervalSeconds: config.monitor.intervalSeconds }, 'monitor started');
  }

  /** Stop the monitor loop. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Run one full evaluation pass. */
  async tick() {
    await Promise.all([this.checkResources(), this.checkServices(), this.checkWebsites()]);
  }

  async checkResources() {
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

  async checkServices() {
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

  async checkWebsites() {
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
   * @param {string} key      Stable identifier for this condition.
   * @param {boolean} isBad   Whether the condition is currently unhealthy.
   * @param {string} title    Alert title.
   * @param {string} detail   Alert body.
   */
  evaluate(key, isBad, title, detail) {
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

  /**
   * Post an embed to the alert channel, tolerating a missing/invalid channel.
   * @param {import('discord.js').EmbedBuilder} embed
   */
  send(embed) {
    const channelId = config.discord.alertChannelId;
    if (!channelId) return;

    const channel = this.client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) {
      log.warn({ channelId }, 'alert channel not found or not text-based');
      return;
    }
    channel.send({ embeds: [embed] }).catch((err) => {
      log.error({ err: err.message }, 'failed to send alert');
    });
  }
}
