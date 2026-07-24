import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { Collection } from 'discord.js';
import { childLogger } from '../logger.js';
import type { CommandModule } from '../types/index.js';

const log = childLogger('commandLoader');
const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = resolve(__dirname, '../commands');

/** Recursively collect all runnable module files under a directory. */
function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (entry.isFile() && isModuleFile(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Accept .ts (dev, run via tsx) and .js (compiled, run via node) but never
 * declaration files or source maps.
 */
function isModuleFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  // Never auto-register a test file that happens to sit next to a module.
  if (name.includes('.test.')) return false;
  return name.endsWith('.ts') || name.endsWith('.js');
}

/**
 * Load every command module into a Collection keyed by command name.
 * Category is inferred from the sub-folder for grouping in /help.
 */
export async function loadCommands(): Promise<Collection<string, CommandModule>> {
  const commands = new Collection<string, CommandModule>();
  const files = collectFiles(commandsDir);

  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: CommandModule };
    const command = mod.default;

    if (!command?.data || typeof command.execute !== 'function') {
      log.warn({ file }, 'skipping invalid command module (missing data/execute)');
      continue;
    }

    // Derive category from the immediate parent folder name.
    command.category = dirname(file).split('/').pop();

    commands.set(command.data.name, command);
    log.debug({ command: command.data.name, category: command.category }, 'loaded command');
  }

  log.info({ count: commands.size }, 'commands loaded');
  return commands;
}

/** Absolute path to the commands directory (used by the deploy script). */
export { commandsDir };
