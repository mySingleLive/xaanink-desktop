import { monitorEventLoopDelay } from "node:perf_hooks"
import os from "node:os"
import { longTaskQueue } from "@/lib/long-task"

const shared = globalThis as typeof globalThis & { novelEventLoopMonitor?: ReturnType<typeof monitorEventLoopDelay> }
const monitor = shared.novelEventLoopMonitor ??= monitorEventLoopDelay({ resolution: 20 })
monitor.enable()
export function resourceObservation() {
  return { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, cpus: os.cpus().length,
    deviceMemoryBytes: os.totalmem(), memory: process.memoryUsage(), uptimeSeconds: process.uptime(), pid: process.pid,
    eventLoop: { samples: monitor.count, meanMs: Number.isFinite(monitor.mean) ? monitor.mean / 1e6 : null, p95Ms: monitor.count ? monitor.percentile(95) / 1e6 : null, maxMs: monitor.count ? monitor.max / 1e6 : null, resolutionMs: 20 },
    longTasks: { active: longTaskQueue.active, queued: longTaskQueue.waiting, limit: longTaskQueue.limit, scope: "process" } }
}
