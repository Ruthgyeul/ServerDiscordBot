import type { Client, SendableChannels } from 'discord.js';
import { config } from '../config/index.js';
import { childLogger } from '../logger.js';
import { infoEmbed } from '../lib/embeds.js';

const log = childLogger('audit');

/**
 * Audit trail for privileged actions.
 *
 * Every state-changing command already leaves a line in the journal, but the
 * journal is only visible to whoever can log into the box — which is exactly
 * the audience that does not need to be told. Mirroring the trail into a
 * Discord channel means the people who can *use* the bot can also see what has
 * been done with it, without server access.
 *
 * Set `AUDIT_CHANNEL_ID` to enable the mirror; the journal line is written
 * either way, so auditing never depends on Discord being reachable.
 */

export interface AuditEntry {
  /** Who performed it, as a Discord tag. */
  actor: string;
  /** Short verb phrase, e.g. "service.restart". */
  action: string;
  /** What it applied to, e.g. the service or command name. */
  target: string;
  /** Optional extra context shown in the channel. */
  detail?: string;
}

/** Record a privileged action to the journal, and to the audit channel if set. */
export function recordAudit(client: Client, entry: AuditEntry): void {
  log.info(
    { actor: entry.actor, action: entry.action, target: entry.target },
    `audit: ${entry.actor} ${entry.action} ${entry.target}`,
  );

  const channelId = config.discord.auditChannelId;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased() || !channel.isSendable()) {
    log.warn({ channelId }, 'audit channel not found or not sendable');
    return;
  }

  const embed = infoEmbed(
    `🔑 ${entry.action}`,
    [`**Actor:** ${entry.actor}`, `**Target:** \`${entry.target}\``, entry.detail]
      .filter(Boolean)
      .join('\n'),
  );

  (channel as SendableChannels).send({ embeds: [embed] }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'failed to write audit entry');
  });
}
