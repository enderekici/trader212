import { createLogger } from '../utils/logger.js';

const log = createLogger('health-metrics');

const RING_BUFFER_SIZE = 100;
const RECENT_RUNS_SIZE = 5;

export interface JobMetrics {
  name: string;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastSuccess: boolean;
  totalRuns: number;
  totalFailures: number;
  avgDurationMs: number;
}

export interface DataSourceHealth {
  name: string;
  lastCallAt: string | null;
  lastSuccess: boolean;
  totalCalls: number;
  totalFailures: number;
  avgLatencyMs: number;
  lastLatencyMs: number | null;
}

export interface HealthSnapshot {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memoryUsage: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  jobs: JobMetrics[];
  dataSources: DataSourceHealth[];
  activePositions: number;
  lastAnalysisCycleAt: string | null;
  lastAnalysisCycleDurationMs: number | null;
  wsClientCount: number;
}

interface JobState {
  startedAt: number | null;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastSuccess: boolean;
  totalRuns: number;
  totalFailures: number;
  durations: number[];
  durationIndex: number;
  durationCount: number;
  recentSuccesses: boolean[];
  recentIndex: number;
  recentCount: number;
}

interface DataSourceState {
  lastCallAt: string | null;
  lastSuccess: boolean;
  totalCalls: number;
  totalFailures: number;
  lastLatencyMs: number | null;
  latencies: number[];
  latencyIndex: number;
  latencyCount: number;
}

export class HealthMetricsCollector {
  private startTime = Date.now();
  private jobMetrics = new Map<string, JobState>();
  private dataSourceMetrics = new Map<string, DataSourceState>();
  private lastAnalysisCycleAt: string | null = null;
  private lastAnalysisCycleDurationMs: number | null = null;
  private wsClientCountFn: (() => number) | null = null;
  private activePositionCountFn: (() => number) | null = null;

  recordJobStart(name: string): void {
    const state = this.getOrCreateJobState(name);
    state.startedAt = Date.now();
    log.debug({ job: name }, 'Job started');
  }

  recordJobEnd(name: string, success: boolean): void {
    const state = this.getOrCreateJobState(name);
    const now = Date.now();
    const durationMs = state.startedAt != null ? now - state.startedAt : 0;

    state.lastRunAt = new Date(now).toISOString();
    state.lastDurationMs = durationMs;
    state.lastSuccess = success;
    state.totalRuns += 1;
    if (!success) {
      state.totalFailures += 1;
    }

    state.durations[state.durationIndex] = durationMs;
    state.durationIndex = (state.durationIndex + 1) % RING_BUFFER_SIZE;
    if (state.durationCount < RING_BUFFER_SIZE) {
      state.durationCount += 1;
    }

    state.recentSuccesses[state.recentIndex] = success;
    state.recentIndex = (state.recentIndex + 1) % RECENT_RUNS_SIZE;
    if (state.recentCount < RECENT_RUNS_SIZE) {
      state.recentCount += 1;
    }

    state.startedAt = null;
    log.debug({ job: name, durationMs, success }, 'Job ended');
  }

  recordDataSourceCall(source: string, success: boolean, latencyMs: number): void {
    const state = this.getOrCreateDataSourceState(source);

    state.lastCallAt = new Date().toISOString();
    state.lastSuccess = success;
    state.totalCalls += 1;
    if (!success) {
      state.totalFailures += 1;
    }
    state.lastLatencyMs = latencyMs;

    state.latencies[state.latencyIndex] = latencyMs;
    state.latencyIndex = (state.latencyIndex + 1) % RING_BUFFER_SIZE;
    if (state.latencyCount < RING_BUFFER_SIZE) {
      state.latencyCount += 1;
    }

    log.debug({ source, latencyMs, success }, 'Data source call recorded');
  }

  recordAnalysisCycle(durationMs: number): void {
    this.lastAnalysisCycleAt = new Date().toISOString();
    this.lastAnalysisCycleDurationMs = durationMs;
    log.debug({ durationMs }, 'Analysis cycle recorded');
  }

  setWsClientCountFn(fn: () => number): void {
    this.wsClientCountFn = fn;
  }

  setActivePositionCountFn(fn: () => number): void {
    this.activePositionCountFn = fn;
  }

  getSnapshot(): HealthSnapshot {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

    return {
      status: this.computeStatus(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsage: {
        heapUsedMB: toMB(mem.heapUsed),
        heapTotalMB: toMB(mem.heapTotal),
        rssMB: toMB(mem.rss),
      },
      jobs: this.getJobMetrics(),
      dataSources: this.getDataSourceHealth(),
      activePositions: this.activePositionCountFn ? this.activePositionCountFn() : 0,
      lastAnalysisCycleAt: this.lastAnalysisCycleAt,
      lastAnalysisCycleDurationMs: this.lastAnalysisCycleDurationMs,
      wsClientCount: this.wsClientCountFn ? this.wsClientCountFn() : 0,
    };
  }

  getJobMetrics(): JobMetrics[] {
    const result: JobMetrics[] = [];
    for (const [name, state] of this.jobMetrics) {
      result.push({
        name,
        lastRunAt: state.lastRunAt,
        lastDurationMs: state.lastDurationMs,
        lastSuccess: state.lastSuccess,
        totalRuns: state.totalRuns,
        totalFailures: state.totalFailures,
        avgDurationMs: this.computeAvgDuration(state),
      });
    }
    return result;
  }

  getDataSourceHealth(): DataSourceHealth[] {
    const result: DataSourceHealth[] = [];
    for (const [name, state] of this.dataSourceMetrics) {
      result.push({
        name,
        lastCallAt: state.lastCallAt,
        lastSuccess: state.lastSuccess,
        totalCalls: state.totalCalls,
        totalFailures: state.totalFailures,
        avgLatencyMs: this.computeAvgLatency(state),
        lastLatencyMs: state.lastLatencyMs,
      });
    }
    return result;
  }

  private computeStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    if (this.jobMetrics.size === 0 && this.dataSourceMetrics.size === 0) {
      return 'healthy';
    }

    let hasJobFailures = false;
    let hasCriticalJobFailures = false;

    for (const state of this.jobMetrics.values()) {
      if (state.recentCount === 0) continue;
      const recentFailures = this.countRecentFailures(state);
      if (recentFailures > state.recentCount / 2) {
        hasCriticalJobFailures = true;
      }
      if (recentFailures > 0) {
        hasJobFailures = true;
      }
    }

    let hasDataSourceDown = false;
    let hasDataSourceDegraded = false;

    for (const state of this.dataSourceMetrics.values()) {
      if (state.totalCalls === 0) continue;
      if (!state.lastSuccess) {
        hasDataSourceDown = true;
      }
      const failureRate = state.totalFailures / state.totalCalls;
      if (failureRate > 0.5) {
        hasDataSourceDegraded = true;
      }
    }

    if (hasDataSourceDown || hasCriticalJobFailures) {
      return 'unhealthy';
    }
    if (hasJobFailures || hasDataSourceDegraded) {
      return 'degraded';
    }
    return 'healthy';
  }

  private countRecentFailures(state: JobState): number {
    let failures = 0;
    for (let i = 0; i < state.recentCount; i++) {
      if (!state.recentSuccesses[i]) failures += 1;
    }
    return failures;
  }

  private computeAvgDuration(state: JobState): number {
    if (state.durationCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < state.durationCount; i++) {
      sum += state.durations[i];
    }
    return Math.round(sum / state.durationCount);
  }

  private computeAvgLatency(state: DataSourceState): number {
    if (state.latencyCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < state.latencyCount; i++) {
      sum += state.latencies[i];
    }
    return Math.round(sum / state.latencyCount);
  }

  private getOrCreateJobState(name: string): JobState {
    let state = this.jobMetrics.get(name);
    if (!state) {
      state = {
        startedAt: null,
        lastRunAt: null,
        lastDurationMs: null,
        lastSuccess: true,
        totalRuns: 0,
        totalFailures: 0,
        durations: new Array(RING_BUFFER_SIZE).fill(0),
        durationIndex: 0,
        durationCount: 0,
        recentSuccesses: new Array(RECENT_RUNS_SIZE).fill(true),
        recentIndex: 0,
        recentCount: 0,
      };
      this.jobMetrics.set(name, state);
    }
    return state;
  }

  private getOrCreateDataSourceState(source: string): DataSourceState {
    let state = this.dataSourceMetrics.get(source);
    if (!state) {
      state = {
        lastCallAt: null,
        lastSuccess: true,
        totalCalls: 0,
        totalFailures: 0,
        lastLatencyMs: null,
        latencies: new Array(RING_BUFFER_SIZE).fill(0),
        latencyIndex: 0,
        latencyCount: 0,
      };
      this.dataSourceMetrics.set(source, state);
    }
    return state;
  }
}

let instance: HealthMetricsCollector | null = null;

export function getHealthMetrics(): HealthMetricsCollector {
  if (!instance) instance = new HealthMetricsCollector();
  return instance;
}
