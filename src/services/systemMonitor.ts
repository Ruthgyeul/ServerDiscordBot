import si from 'systeminformation';

/**
 * Collects host system metrics via the `systeminformation` library, which
 * reads from /proc, /sys and standard tools in a cross-distro way. This keeps
 * us out of fragile hand-rolled shell parsing.
 */

export interface DiskUsage {
  mount: string;
  usePercent: number;
  used: number; // bytes
  size: number; // bytes
}

export interface SystemSnapshot {
  cpuPercent: number;
  loadAvg1: number;
  memPercent: number;
  memUsed: number; // bytes
  memTotal: number; // bytes
  uptime: number; // seconds
  disks: DiskUsage[];
}

export interface HostInfo {
  hostname: string;
  platform: string;
  distro: string;
  kernel: string;
}

/** Gather a full snapshot of host metrics in one call. */
export async function getSnapshot(): Promise<SystemSnapshot> {
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

  const disks: DiskUsage[] = fsSize
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

/** Static host identity information, useful for the status header. */
export async function getHostInfo(): Promise<HostInfo> {
  const os = await si.osInfo();
  return {
    hostname: os.hostname,
    platform: os.platform,
    distro: `${os.distro} ${os.release}`.trim(),
    kernel: os.kernel,
  };
}
