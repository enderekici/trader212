import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PriceStreamer, getPriceStreamer } from '../../src/data/price-streamer.js';
import type { PositionForStreaming, PriceUpdate, StopTriggered } from '../../src/data/price-streamer.js';

// Mock config manager
vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn((key: string) => {
			const defaults: Record<string, unknown> = {
				'streaming.enabled': true,
				'streaming.intervalSeconds': 15,
			};
			return defaults[key];
		}),
	},
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

// Helper to flush the floating promise from pollPrices()
async function flushPolling(): Promise<void> {
	await vi.advanceTimersByTimeAsync(0);
	// Extra microtask flush for async quoteFn
	await Promise.resolve();
	await Promise.resolve();
}

describe('PriceStreamer', () => {
	let streamer: PriceStreamer;

	beforeEach(async () => {
		vi.clearAllMocks();
		// Reset config mock to defaults
		const { configManager } = await import('../../src/config/manager.js');
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			const defaults: Record<string, unknown> = {
				'streaming.enabled': true,
				'streaming.intervalSeconds': 15,
			};
			return defaults[key];
		});
		streamer = new PriceStreamer();
		vi.useFakeTimers();
	});

	afterEach(() => {
		streamer.stop();
		vi.useRealTimers();
	});

	describe('start/stop', () => {
		it('starts and sets running state', () => {
			streamer.setPositionProvider(() => []);
			streamer.setQuoteProvider(async () => new Map());

			expect(streamer.isRunning()).toBe(false);
			streamer.start();
			expect(streamer.isRunning()).toBe(true);
		});

		it('stops and clears state', () => {
			streamer.setPositionProvider(() => []);
			streamer.setQuoteProvider(async () => new Map());

			streamer.start();
			streamer.stop();
			expect(streamer.isRunning()).toBe(false);
		});

		it('does not start when already running', () => {
			streamer.setPositionProvider(() => []);
			streamer.setQuoteProvider(async () => new Map());

			streamer.start();
			streamer.start(); // Should be a no-op
			expect(streamer.isRunning()).toBe(true);
		});

		it('does not start when streaming is disabled', async () => {
			const { configManager } = await import('../../src/config/manager.js');
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'streaming.enabled') return false;
				return 15;
			});

			streamer.start();
			expect(streamer.isRunning()).toBe(false);
		});
	});

	describe('price updates', () => {
		it('emits price_update events', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 155,
				},
			];

			const quotes = new Map([['AAPL', 160]]);

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => quotes);

			const updates: PriceUpdate[] = [];
			streamer.on('price_update', (update) => updates.push(update));

			streamer.start();
			await flushPolling();

			expect(updates).toHaveLength(1);
			expect(updates[0].symbol).toBe('AAPL');
			expect(updates[0].price).toBe(160);
			expect(updates[0].previousPrice).toBe(155);
		});

		it('uses entry price when currentPrice is null', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'MSFT',
					entryPrice: 300,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: null,
				},
			];

			const quotes = new Map([['MSFT', 310]]);

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => quotes);

			const updates: PriceUpdate[] = [];
			streamer.on('price_update', (update) => updates.push(update));

			streamer.start();
			await flushPolling();

			expect(updates[0].previousPrice).toBe(300); // entry price used
		});

		it('uses last known price on subsequent polls', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 155,
				},
			];

			let currentQuotePrice = 160;
			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map([['AAPL', currentQuotePrice]]));

			const updates: PriceUpdate[] = [];
			streamer.on('price_update', (update) => updates.push(update));

			streamer.start();
			await flushPolling(); // First poll

			currentQuotePrice = 165;
			await vi.advanceTimersByTimeAsync(15000); // Second poll
			await flushPolling();

			expect(updates).toHaveLength(2);
			expect(updates[1].previousPrice).toBe(160); // Last known price
			expect(updates[1].price).toBe(165);
		});

		it('skips symbols with no quotes', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 155,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map()); // No quotes

			const updates: PriceUpdate[] = [];
			streamer.on('price_update', (update) => updates.push(update));

			streamer.start();
			await flushPolling();

			expect(updates).toHaveLength(0);
		});

		it('does nothing when no positions', async () => {
			streamer.setPositionProvider(() => []);
			streamer.setQuoteProvider(async () => new Map());

			const updates: PriceUpdate[] = [];
			streamer.on('price_update', (update) => updates.push(update));

			streamer.start();
			await flushPolling();

			expect(updates).toHaveLength(0);
		});
	});

	describe('stop triggers', () => {
		it('emits stop_loss trigger when price <= stopLossPrice', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: 140,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 145,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map([['AAPL', 139]]));

			const triggers: StopTriggered[] = [];
			streamer.on('stop_triggered', (t) => triggers.push(t));

			streamer.start();
			await flushPolling();

			expect(triggers).toHaveLength(1);
			expect(triggers[0].stopType).toBe('stop_loss');
			expect(triggers[0].currentPrice).toBe(139);
			expect(triggers[0].stopPrice).toBe(140);
		});

		it('emits trailing_stop trigger', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'MSFT',
					entryPrice: 300,
					stopLossPrice: null,
					trailingStop: 290,
					takeProfitPrice: null,
					currentPrice: 295,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map([['MSFT', 289]]));

			const triggers: StopTriggered[] = [];
			streamer.on('stop_triggered', (t) => triggers.push(t));

			streamer.start();
			await flushPolling();

			expect(triggers).toHaveLength(1);
			expect(triggers[0].stopType).toBe('trailing_stop');
		});

		it('emits take_profit trigger when price >= takeProfitPrice', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'TSLA',
					entryPrice: 200,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: 250,
					currentPrice: 240,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map([['TSLA', 255]]));

			const triggers: StopTriggered[] = [];
			streamer.on('stop_triggered', (t) => triggers.push(t));

			streamer.start();
			await flushPolling();

			expect(triggers).toHaveLength(1);
			expect(triggers[0].stopType).toBe('take_profit');
			expect(triggers[0].currentPrice).toBe(255);
		});

		it('does not trigger when price is safe', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: 140,
					trailingStop: null,
					takeProfitPrice: 180,
					currentPrice: 155,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => new Map([['AAPL', 160]])); // Between stops

			const triggers: StopTriggered[] = [];
			streamer.on('stop_triggered', (t) => triggers.push(t));

			streamer.start();
			await flushPolling();

			expect(triggers).toHaveLength(0);
		});
	});

	describe('error handling', () => {
		it('emits error event on quote provider failure', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 155,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => {
				throw new Error('API down');
			});

			const errors: Error[] = [];
			streamer.on('error', (err) => errors.push(err));

			streamer.start();
			await flushPolling();

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe('API down');
		});

		it('wraps non-Error throws', async () => {
			const positions: PositionForStreaming[] = [
				{
					symbol: 'AAPL',
					entryPrice: 150,
					stopLossPrice: null,
					trailingStop: null,
					takeProfitPrice: null,
					currentPrice: 155,
				},
			];

			streamer.setPositionProvider(() => positions);
			streamer.setQuoteProvider(async () => {
				throw 'string error';
			});

			const errors: Error[] = [];
			streamer.on('error', (err) => errors.push(err));

			streamer.start();
			await flushPolling();

			expect(errors).toHaveLength(1);
			expect(errors[0].message).toBe('string error');
		});

		it('does nothing when providers not set', async () => {
			// No providers set - should not crash
			streamer.start();
			await flushPolling();
			expect(streamer.isRunning()).toBe(true);
		});
	});

	describe('getPriceStreamer singleton', () => {
		it('returns same instance', () => {
			const a = getPriceStreamer();
			const b = getPriceStreamer();
			expect(a).toBe(b);
		});
	});
});
