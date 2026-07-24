import si from 'systeminformation';
import { config } from '../config/index.js';

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
  cpuCores: number;
  memPercent: number;
  memUsed: number; // bytes
  memTotal: number; // bytes
  swapPercent: number;
  swapUsed: number; // bytes
  swapTotal: number; // bytes
  uptime: number; // seconds
  disks: DiskUsage[];
}

export interface HostInfo {
  hostname: string;
  platform: string;
  distro: string;
  kernel: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpuPercent: number;
  memPercent: number;
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

  return {
    cpuPercent: load.currentLoad,
    loadAvg1: load.avgLoad ?? 0,
    cpuCores: load.cpus?.length ?? 0,
    memPercent,
    memUsed,
    memTotal: mem.total,
    swapPercent: mem.swaptotal > 0 ? (mem.swapused / mem.swaptotal) * 100 : 0,
    swapUsed: mem.swapused,
    swapTotal: mem.swaptotal,
    uptime: time.uptime,
    disks: selectDisks(fsSize),
  };
}

/**
 * Reduce the raw filesystem list to the mounts worth reporting: real
 * filesystems only, minus anything the operator excluded through
 * `monitor.ignoreMounts` (snap loops, bind mounts, container overlays…).
 */
function selectDisks(filesystems: si.Systeminformation.FsSizeData[]): DiskUsage[] {
  const ignored = config.monitor.ignoreMounts;

  return (
    filesystems
      // Ignore pseudo/virtual filesystems that report 0 size.
      .filter((fs) => fs.size > 0 && fs.mount)
      .filter(
        (fs) =>
          !ignored.some((prefix) => fs.mount === prefix || fs.mount.startsWith(`${prefix}/`)),
      )
      .map((fs) => ({
        mount: fs.mount,
        usePercent: fs.use,
        used: fs.used,
        size: fs.size,
      }))
  );
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

/**
 * The heaviest processes on the host — for answering "what is eating the box?"
 * without opening an SSH session.
 */
export async function getTopProcesses(
  sortBy: 'cpu' | 'memory',
  limit = 10,
): Promise<ProcessInfo[]> {
  const { list } = await si.processes();

  return list
    .map((proc) => ({
      pid: proc.pid,
      name: proc.name,
      user: proc.user,
      cpuPercent: proc.cpu,
      memPercent: proc.mem,
    }))
    .sort((a, b) =>
      sortBy === 'cpu' ? b.cpuPercent - a.cpuPercent : b.memPercent - a.memPercent,
    )
    .slice(0, limit);
}
