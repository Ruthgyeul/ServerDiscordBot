import { open, stat } from 'node:fs/promises';
import { findFile, config } from '../config/index.js';
import { childLogger } from '../logger.js';
import type { FileTargetConfig } from '../types.js';

const log = childLogger('fileViewer');

/**
 * Read-only viewer for the files declared in `config.files`.
 *
 * Only allowlisted paths are readable — a Discord user supplies a *key*, never
 * a path, so there is no traversal surface. Reads are bounded from the end of
 * the file so tailing a multi-gigabyte log costs the same as tailing a small
 * one, and can never pull the whole file into memory.
 */

/** Upper bound on how much of the file's tail we are willing to scan. */
const MAX_TAIL_BYTES = 256 * 1024;

export interface FileInfo {
  entry: FileTargetConfig;
  exists: boolean;
  readable: boolean;
  size: number;
  modified: Date | null;
  error: string | null;
}

export interface TailResult {
  entry: FileTargetConfig;
  lines: string[];
  /** True when the requested window was cut short by MAX_TAIL_BYTES. */
  truncated: boolean;
  size: number;
}

/** Stat every configured file, tolerating missing or unreadable paths. */
export async function listFiles(): Promise<FileInfo[]> {
  return Promise.all(config.files.map((entry) => describeFile(entry)));
}

async function describeFile(entry: FileTargetConfig): Promise<FileInfo> {
  try {
    const stats = await stat(entry.path);
    if (!stats.isFile()) {
      return blankInfo(entry, 'Not a regular file.');
    }
    return {
      entry,
      exists: true,
      readable: true,
      size: stats.size,
      modified: stats.mtime,
      error: null,
    };
  } catch (rawError) {
    const error = rawError as NodeJS.ErrnoException;
    const reason =
      error.code === 'ENOENT'
        ? 'File does not exist.'
        : error.code === 'EACCES'
          ? 'Permission denied — the bot user cannot read this path.'
          : error.message;
    return blankInfo(entry, reason);
  }
}

function blankInfo(entry: FileTargetConfig, error: string): FileInfo {
  return { entry, exists: false, readable: false, size: 0, modified: null, error };
}

/**
 * Read the last `lines` lines of an allowlisted file.
 *
 * @param name     Key from `config.files`.
 * @param lines    Requested line count, clamped to the entry's `maxLines`.
 * @param contains Optional case-insensitive substring filter applied to the
 *                 window that was read.
 */
export async function tailFile(
  name: string,
  lines: number,
  contains?: string,
): Promise<TailResult> {
  const entry = findFile(name);
  if (!entry) {
    throw new Error(`Unknown file "${name}". Not in the allowlist.`);
  }

  const wanted = Math.max(1, Math.min(entry.maxLines, Math.floor(lines)));
  log.info({ file: entry.name, path: entry.path, lines: wanted }, 'reading file tail');

  const handle = await open(entry.path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, size - length));

    const text = buffer.toString('utf8');
    // A partial first line is an artifact of the byte window, not real content.
    const all = text.split('\n');
    if (length < size && all.length > 1) all.shift();

    const filtered = contains
      ? all.filter((line) => line.toLowerCase().includes(contains.toLowerCase()))
      : all;
    const selected = filtered.filter((line) => line.length > 0).slice(-wanted);

    return { entry, lines: selected, truncated: length < size, size };
  } finally {
    await handle.close();
  }
}
