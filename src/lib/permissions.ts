import type { GuildMember, Interaction } from 'discord.js';
import { config } from '../config.js';

/** Permission levels a command can require. */
export enum Permission {
  /** Anyone in the server may run the command. */
  EVERYONE = 'everyone',
  /** Only configured admin users/roles may run the command. */
  ADMIN = 'admin',
}

/**
 * Decide whether a member is an administrator of the bot.
 *
 * A member qualifies if their user ID is in ADMIN_USER_IDS, or if they hold
 * any role listed in ADMIN_ROLE_IDS. This is independent from Discord's own
 * "Administrator" permission on purpose, so bot control can be delegated
 * without granting server-wide power.
 */
export function isAdmin(member: GuildMember | null): boolean {
  if (!member) return false;

  if (config.access.adminUserIds.includes(member.id)) return true;

  const roleIds = config.access.adminRoleIds;
  if (roleIds.length > 0 && member.roles?.cache) {
    return member.roles.cache.some((role) => roleIds.includes(role.id));
  }

  return false;
}

/** Check whether an interaction's author satisfies a required permission level. */
export function hasPermission(interaction: Interaction, required: Permission): boolean {
  if (required === Permission.EVERYONE) return true;
  // interaction.member is a GuildMember in guild contexts; null in DMs.
  return isAdmin(interaction.member as GuildMember | null);
}
