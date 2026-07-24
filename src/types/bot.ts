import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { Permission } from '../lib/permissions.js';
import type { AlertScheduler } from '../services/monitor/alertScheduler.js';
import type { PresenceManager } from '../services/monitor/presence.js';
import type { AuditEntry } from '../services/audit.js';

/**
 * The Discord-facing contracts: what a command module must provide, what an
 * event module must provide, and what both receive from the runtime.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Command / event contracts
 * ──────────────────────────────────────────────────────────────────────────── */

/** Any of the slash-command builder shapes a command's `data` may take. */
export type SlashCommandData =
  SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

/**
 * The context object dependency-injected into every command and event handler,
 * avoiding hidden global state.
 */
export interface BotContext {
  client: Client;
  commands: Collection<string, CommandModule>;
  alertScheduler: AlertScheduler;
  presence: PresenceManager;
  /**
   * Record a privileged action. Bound to the client at construction, so a
   * command states *what* happened without also having to know where the
   * audit trail goes.
   */
  audit(entry: AuditEntry): void;
}

/** Contract every file under src/commands/ must satisfy. */
export interface CommandModule {
  data: SlashCommandData;
  /** Required access level; defaults to admin when omitted. */
  permission?: Permission;
  /** Filled in by the loader from the containing folder name. */
  category?: string;
  /**
   * Per-user cooldown in seconds. These commands do real work on the host —
   * a process table walk, an HTTP sweep, a systemctl call — so an impatient
   * double-click should not turn into two host probes. 0 means no limit.
   */
  cooldownSeconds?: number;
  execute(interaction: ChatInputCommandInteraction, context: BotContext): Promise<void> | void;
  /**
   * Optional handler for option autocomplete. Implementing this lets a command
   * offer choices sourced from config at runtime, so inventory changes need no
   * re-registration of the command.
   */
  autocomplete?(
    interaction: AutocompleteInteraction,
    context: BotContext,
  ): Promise<void> | void;
}

/**
 * Contract every file under src/events/ must satisfy. `execute` receives the
 * event's native arguments followed by the shared context (appended by the
 * loader).
 */
export interface EventModule {
  name: string;
  once?: boolean;
  execute(...args: unknown[]): Promise<void> | void;
}
