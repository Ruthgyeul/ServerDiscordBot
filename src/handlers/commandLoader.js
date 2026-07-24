import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Collection } from 'discord.js';
import { childLogger } from '../logger.js';

const log = childLogger('commandLoader');
const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = resolve(__dirname, '../commands');

/**
 * A command module contract. Every file under src/commands/ must export:
 *   - `data`: a SlashCommandBuilder (or JSON) describing the command.
 *   - `execute(interaction, context)`: the handler.
 *   - `permission` (optional): a {@link Permission} value; defaults to admin
 *     for anything not explicitly public.
 * @typedef {object} Command
 * @property {import('discord.js').SlashCommandBuilder} data
 * @property {(interaction: any, context: any) => Promise<void>} execute
 * @property {string} [permission]
 */

/**
 * Recursively collect all .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Load every command module into a Collection keyed by command name.
 * Category is inferred from the sub-folder for grouping in /help.
 * @returns {Promise<Collection<string, Command>>}
 */
export async function loadCommands() {
  const commands = new Collection();
  const files = collectFiles(commandsDir);

  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const command = mod.default ?? mod;

    if (!command?.data || typeof command.execute !== 'function') {
      log.warn({ file }, 'skipping invalid command module (missing data/execute)');
      continue;
    }

    // Derive category from the immediate parent folder name.
    const category = dirname(file).split('/').pop();
    command.category = category;

    commands.set(command.data.name, command);
    log.debug({ command: command.data.name, category }, 'loaded command');
  }

  log.info({ count: commands.size }, 'commands loaded');
  return commands;
}

/** Absolute path to the commands directory (used by the deploy script). */
export { commandsDir };
