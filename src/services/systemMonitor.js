import si from 'systeminformation';

/**
 * Collects host system metrics via the `systeminformation` library, which
 * reads from /proc, /sys and standard tools in a cross-distro way. This keeps
 * us out of fragile hand-rolled shell parsing.
 */

/**
 * @typedef {object} SystemSnapshot
 * @property {number} cpuPercent   Overall CPU load (0..100).
 * @property {number} loadAvg1     1-minute load average.
 * @property {number} memPercent   Used memory as a percentage (0..100).
 * @property {number} memUsed      Used memory in bytes (active).
 * @property {number} memTotal     Total memory in bytes.
 * @property {number} uptime       System uptime in seconds.
 * @property {DiskUsage[]} disks    Per-filesystem usage.
 */

/**
 * @typedef {object} DiskUsage
 * @property {string} mount   Mount point (e.g. "/").
 * @property {number} usePercent
 * @property {number} used    bytes
 * @property {number} size    bytes
 */

/**
 * Gather a full snapshot of host metrics in one call.
 * @returns {Promise<SystemSnapshot>}
 */
export async function getSnapshot() {
  const [load, mem, time, fsSize] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    Promise.resolve(si.time()),
    si.fsSize(),
  ]);

  // `active` reflects memory genuinely in use (excludes reclaimable cache),
  // which matches what an operator intuitively considers "used".
  const memUsed = mem.active;
  const memPercent = (memUsed / mem.total) * 100;

  const disks = fsSize
    // Ignore pseudo/virtual filesystems that report 0 size.
    .filter((fs) => fs.size > 0 && fs.mount)
    .map((fs) => ({
      mount: fs.mount,
      usePercent: fs.use,
      used: fs.used,
      size: fs.size,
    }));

  return {
    cpuPercent: load.currentLoad,
    loadAvg1: load.avgLoad ?? 0,
    memPercent,
    memUsed,
    memTotal: mem.total,
    uptime: time.uptime,
    disks,
  };
}

/**
 * Static host identity information, useful for the status header.
 * @returns {Promise<{ hostname: string, platform: string, distro: string, kernel: string }>}
 */
export async function getHostInfo() {
  const os = await si.osInfo();
  return {
    hostname: os.hostname,
    platform: os.platform,
    distro: `${os.distro} ${os.release}`.trim(),
    kernel: os.kernel,
  };
}
