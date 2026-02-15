import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	HealthMetricsCollector,
	getHealthMetrics,
} from '../../src/monitoring/health-metrics.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

describe('HealthMetricsCollector', () => {
	let collector: HealthMetricsCollector;

	beforeEach(() => {
		collector = new HealthMetricsCollector();
	});

	describe('job metrics', () => {
		it('records job start and end', () => {
			collector.recordJobStart('testJob');
			collector.recordJobEnd('testJob', true);

			const metrics = collector.getJobMetrics();
			expect(metrics).toHaveLength(1);
			expect(metrics[0].name).toBe('testJob');
			expect(metrics[0].totalRuns).toBe(1);
			expect(metrics[0].totalFailures).toBe(0);
			expect(metrics[0].lastSuccess).toBe(true);
			expect(metrics[0].lastRunAt).toBeTruthy();
			expect(metrics[0].lastDurationMs).toBeGreaterThanOrEqual(0);
		});

		it('tracks failures', () => {
			collector.recordJobStart('failJob');
			collector.recordJobEnd('failJob', false);

			const metrics = collector.getJobMetrics();
			expect(metrics[0].totalFailures).toBe(1);
			expect(metrics[0].lastSuccess).toBe(false);
		});

		it('computes average duration over multiple runs', () => {
			// Simulate 3 runs with known durations (approximately)
			for (let i = 0; i < 3; i++) {
				collector.recordJobStart('avgJob');
				collector.recordJobEnd('avgJob', true);
			}

			const metrics = collector.getJobMetrics();
			expect(metrics[0].totalRuns).toBe(3);
			expect(metrics[0].avgDurationMs).toBeGreaterThanOrEqual(0);
		});

		it('tracks multiple jobs independently', () => {
			collector.recordJobStart('job1');
			collector.recordJobEnd('job1', true);
			collector.recordJobStart('job2');
			collector.recordJobEnd('job2', false);

			const metrics = collector.getJobMetrics();
			expect(metrics).toHaveLength(2);

			const job1 = metrics.find((m) => m.name === 'job1');
			const job2 = metrics.find((m) => m.name === 'job2');
			expect(job1?.lastSuccess).toBe(true);
			expect(job2?.lastSuccess).toBe(false);
		});

		it('handles recordJobEnd without prior start', () => {
			collector.recordJobEnd('noStartJob', true);

			const metrics = collector.getJobMetrics();
			expect(metrics[0].lastDurationMs).toBe(0);
			expect(metrics[0].totalRuns).toBe(1);
		});
	});

	describe('data source metrics', () => {
		it('records data source calls', () => {
			collector.recordDataSourceCall('yahoo', true, 150);

			const sources = collector.getDataSourceHealth();
			expect(sources).toHaveLength(1);
			expect(sources[0].name).toBe('yahoo');
			expect(sources[0].totalCalls).toBe(1);
			expect(sources[0].lastSuccess).toBe(true);
			expect(sources[0].lastLatencyMs).toBe(150);
		});

		it('tracks failures', () => {
			collector.recordDataSourceCall('finnhub', false, 5000);

			const sources = collector.getDataSourceHealth();
			expect(sources[0].totalFailures).toBe(1);
			expect(sources[0].lastSuccess).toBe(false);
		});

		it('computes average latency', () => {
			collector.recordDataSourceCall('yahoo', true, 100);
			collector.recordDataSourceCall('yahoo', true, 200);
			collector.recordDataSourceCall('yahoo', true, 300);

			const sources = collector.getDataSourceHealth();
			expect(sources[0].avgLatencyMs).toBe(200);
		});
	});

	describe('analysis cycle', () => {
		it('records analysis cycle duration', () => {
			collector.recordAnalysisCycle(5000);

			const snapshot = collector.getSnapshot();
			expect(snapshot.lastAnalysisCycleDurationMs).toBe(5000);
			expect(snapshot.lastAnalysisCycleAt).toBeTruthy();
		});
	});

	describe('getSnapshot', () => {
		it('returns healthy status with no data', () => {
			const snapshot = collector.getSnapshot();
			expect(snapshot.status).toBe('healthy');
			expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
			expect(snapshot.memoryUsage.heapUsedMB).toBeGreaterThan(0);
			expect(snapshot.memoryUsage.rssMB).toBeGreaterThan(0);
			expect(snapshot.activePositions).toBe(0);
			expect(snapshot.wsClientCount).toBe(0);
		});

		it('uses provider functions for positions and ws clients', () => {
			collector.setActivePositionCountFn(() => 5);
			collector.setWsClientCountFn(() => 3);

			const snapshot = collector.getSnapshot();
			expect(snapshot.activePositions).toBe(5);
			expect(snapshot.wsClientCount).toBe(3);
		});

		it('returns healthy when all jobs succeed', () => {
			collector.recordJobStart('job1');
			collector.recordJobEnd('job1', true);
			collector.recordDataSourceCall('yahoo', true, 100);

			const snapshot = collector.getSnapshot();
			expect(snapshot.status).toBe('healthy');
		});

		it('returns degraded when some jobs fail', () => {
			collector.recordJobStart('job1');
			collector.recordJobEnd('job1', false);
			collector.recordJobStart('job1');
			collector.recordJobEnd('job1', true);

			const snapshot = collector.getSnapshot();
			expect(snapshot.status).toBe('degraded');
		});

		it('returns unhealthy when data source is down', () => {
			collector.recordDataSourceCall('yahoo', false, 0);

			const snapshot = collector.getSnapshot();
			expect(snapshot.status).toBe('unhealthy');
		});

		it('returns unhealthy when most recent jobs fail', () => {
			// Fill with failures to exceed half threshold
			for (let i = 0; i < 4; i++) {
				collector.recordJobStart('job1');
				collector.recordJobEnd('job1', false);
			}
			collector.recordJobStart('job1');
			collector.recordJobEnd('job1', true);

			const snapshot = collector.getSnapshot();
			expect(snapshot.status).toBe('unhealthy');
		});
	});

	describe('getHealthMetrics singleton', () => {
		it('returns same instance', () => {
			const a = getHealthMetrics();
			const b = getHealthMetrics();
			expect(a).toBe(b);
		});
	});
});
