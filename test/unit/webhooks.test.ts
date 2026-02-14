import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// Mock dependencies
vi.mock('../../src/config/manager.js', () => ({
	configManager: {
		get: vi.fn(),
	},
}));

vi.mock('../../src/utils/logger.js', () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	})),
}));

vi.mock('../../src/db/index.js', () => ({
	getDb: vi.fn(),
}));

// Import mocked dependencies
import { configManager } from '../../src/config/manager.js';
import { getDb } from '../../src/db/index.js';

// Import implementations
import {
	getActiveWebhooks,
	getWebhookById,
	createWebhook,
	updateWebhook,
	deleteWebhook,
	logWebhook,
	getWebhookLogs,
	type WebhookConfig,
	type WebhookLog,
} from '../../src/db/repositories/webhooks.js';

import {
	WebhookManager,
	getWebhookManager,
	type WebhookPayload,
} from '../../src/api/webhooks.js';

describe('Webhook Repository', () => {
	let mockDb: any;

	beforeEach(() => {
		mockDb = {
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			update: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			values: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			returning: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			all: vi.fn().mockReturnValue([]),
			get: vi.fn().mockReturnValue(null),
			run: vi.fn(),
		};

		vi.mocked(getDb).mockReturnValue(mockDb);
	});

	describe('getActiveWebhooks', () => {
		it('should return all active webhooks when no direction specified', () => {
			const mockWebhooks: WebhookConfig[] = [
				{
					id: 1,
					name: 'Test Webhook',
					url: 'https://example.com/webhook',
					secret: 'secret123',
					direction: 'outbound',
					eventTypes: '["trade_executed"]',
					active: true,
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			mockDb.all.mockReturnValue(mockWebhooks);

			const result = getActiveWebhooks();

			expect(result).toEqual(mockWebhooks);
			expect(mockDb.select).toHaveBeenCalled();
			expect(mockDb.where).toHaveBeenCalled();
		});

		it('should filter by direction when specified', () => {
			const mockWebhooks: WebhookConfig[] = [
				{
					id: 2,
					name: 'Inbound Webhook',
					url: null,
					secret: 'secret456',
					direction: 'inbound',
					eventTypes: null,
					active: true,
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			mockDb.all.mockReturnValue(mockWebhooks);

			const result = getActiveWebhooks('inbound');

			expect(result).toEqual(mockWebhooks);
			expect(mockDb.where).toHaveBeenCalled();
		});

		it('should return empty array on error', () => {
			mockDb.all.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = getActiveWebhooks();

			expect(result).toEqual([]);
		});
	});

	describe('getWebhookById', () => {
		it('should return webhook when found', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: 'https://example.com/webhook',
				secret: 'secret123',
				direction: 'outbound',
				eventTypes: '["alert"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockWebhook);

			const result = getWebhookById(1);

			expect(result).toEqual(mockWebhook);
			expect(mockDb.select).toHaveBeenCalled();
			expect(mockDb.where).toHaveBeenCalled();
		});

		it('should return null when webhook not found', () => {
			mockDb.get.mockReturnValue(null);

			const result = getWebhookById(999);

			expect(result).toBeNull();
		});

		it('should return null on error', () => {
			mockDb.get.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = getWebhookById(1);

			expect(result).toBeNull();
		});
	});

	describe('createWebhook', () => {
		it('should create webhook with all fields', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'New Webhook',
				url: 'https://example.com/webhook',
				secret: 'secret123',
				direction: 'outbound',
				eventTypes: '["trade_executed","signal_generated"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockWebhook);

			const result = createWebhook({
				name: 'New Webhook',
				url: 'https://example.com/webhook',
				secret: 'secret123',
				direction: 'outbound',
				eventTypes: ['trade_executed', 'signal_generated'],
			});

			expect(result).toEqual(mockWebhook);
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.values).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'New Webhook',
					url: 'https://example.com/webhook',
					secret: 'secret123',
					direction: 'outbound',
					active: true,
				}),
			);
		});

		it('should create webhook with minimal fields', () => {
			const mockWebhook: WebhookConfig = {
				id: 2,
				name: 'Minimal Webhook',
				url: null,
				secret: null,
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockWebhook);

			const result = createWebhook({
				name: 'Minimal Webhook',
				url: null,
				secret: null,
				direction: 'inbound',
			});

			expect(result).toEqual(mockWebhook);
		});

		it('should return null on error', () => {
			mockDb.get.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = createWebhook({
				name: 'Failed Webhook',
				url: null,
				secret: null,
				direction: 'outbound',
			});

			expect(result).toBeNull();
		});
	});

	describe('updateWebhook', () => {
		it('should update webhook fields', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Updated Webhook',
				url: 'https://new-url.com/webhook',
				secret: 'newsecret',
				direction: 'outbound',
				eventTypes: '["custom"]',
				active: false,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockWebhook);

			const result = updateWebhook(1, {
				name: 'Updated Webhook',
				url: 'https://new-url.com/webhook',
				active: false,
			});

			expect(result).toEqual(mockWebhook);
			expect(mockDb.update).toHaveBeenCalled();
			expect(mockDb.set).toHaveBeenCalled();
		});

		it('should handle partial updates', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test',
				url: 'https://example.com',
				secret: 'secret',
				direction: 'outbound',
				eventTypes: null,
				active: false,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockWebhook);

			const result = updateWebhook(1, { active: false });

			expect(result).toEqual(mockWebhook);
		});

		it('should return null on error', () => {
			mockDb.get.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = updateWebhook(1, { active: false });

			expect(result).toBeNull();
		});
	});

	describe('deleteWebhook', () => {
		it('should delete webhook successfully', () => {
			const result = deleteWebhook(1);

			expect(result).toBe(true);
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.run).toHaveBeenCalled();
		});

		it('should return false on error', () => {
			mockDb.run.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = deleteWebhook(1);

			expect(result).toBe(false);
		});
	});

	describe('logWebhook', () => {
		it('should log webhook event with all fields', () => {
			const mockLog: WebhookLog = {
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'trade_executed',
				payload: '{"test":"data"}',
				statusCode: 200,
				response: 'OK',
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockLog);

			const result = logWebhook({
				webhookId: 1,
				direction: 'outbound',
				eventType: 'trade_executed',
				payload: { test: 'data' },
				statusCode: 200,
				response: 'OK',
			});

			expect(result).toEqual(mockLog);
			expect(mockDb.insert).toHaveBeenCalled();
		});

		it('should log webhook event without optional fields', () => {
			const mockLog: WebhookLog = {
				id: 2,
				webhookId: null,
				direction: 'inbound',
				eventType: 'alert',
				payload: null,
				statusCode: null,
				response: null,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValue(mockLog);

			const result = logWebhook({
				direction: 'inbound',
				eventType: 'alert',
			});

			expect(result).toEqual(mockLog);
		});

		it('should return null on error', () => {
			mockDb.get.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = logWebhook({
				direction: 'outbound',
				eventType: 'test',
			});

			expect(result).toBeNull();
		});
	});

	describe('getWebhookLogs', () => {
		it('should return all logs with default limit', () => {
			const mockLogs: WebhookLog[] = [
				{
					id: 1,
					webhookId: 1,
					direction: 'outbound',
					eventType: 'trade_executed',
					payload: '{"test":"data"}',
					statusCode: 200,
					response: 'OK',
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			mockDb.all.mockReturnValue(mockLogs);

			const result = getWebhookLogs();

			expect(result).toEqual(mockLogs);
			expect(mockDb.select).toHaveBeenCalled();
			expect(mockDb.limit).toHaveBeenCalledWith(100);
		});

		it('should filter by webhook ID', () => {
			const mockLogs: WebhookLog[] = [];

			mockDb.all.mockReturnValue(mockLogs);

			const result = getWebhookLogs(1, 50);

			expect(result).toEqual(mockLogs);
			expect(mockDb.where).toHaveBeenCalled();
			expect(mockDb.limit).toHaveBeenCalledWith(50);
		});

		it('should return empty array on error', () => {
			mockDb.all.mockImplementation(() => {
				throw new Error('DB error');
			});

			const result = getWebhookLogs();

			expect(result).toEqual([]);
		});
	});
});

describe('WebhookManager', () => {
	let manager: WebhookManager;
	let mockDb: any;
	let fetchMock: any;

	beforeEach(() => {
		// Reset singleton
		vi.resetModules();

		mockDb = {
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			update: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			values: vi.fn().mockReturnThis(),
			set: vi.fn().mockReturnThis(),
			returning: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			all: vi.fn().mockReturnValue([]),
			get: vi.fn().mockReturnValue(null),
			run: vi.fn(),
		};

		vi.mocked(getDb).mockReturnValue(mockDb);

		// Setup config mock
		vi.mocked(configManager.get).mockImplementation((key: string) => {
			if (key === 'webhook.enabled') return true;
			if (key === 'webhook.maxRetries') return 3;
			if (key === 'webhook.secret') return 'global-secret';
			return undefined;
		});

		// Mock fetch
		fetchMock = vi.fn();
		global.fetch = fetchMock;

		manager = new WebhookManager();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Signature Generation and Verification', () => {
		it('should generate valid HMAC-SHA256 signature', () => {
			const payload = '{"test":"data"}';
			const secret = 'test-secret';

			const signature = crypto
				.createHmac('sha256', secret)
				.update(payload)
				.digest('hex');

			const isValid = manager.verifySignature(payload, signature, secret);

			expect(isValid).toBe(true);
		});

		it('should reject invalid signature', () => {
			const payload = '{"test":"data"}';
			const secret = 'test-secret';
			const wrongSignature = 'invalid-signature-12345678901234567890123456789012';

			const isValid = manager.verifySignature(
				payload,
				wrongSignature,
				secret,
			);

			expect(isValid).toBe(false);
		});

		it('should reject signature with different secret', () => {
			const payload = '{"test":"data"}';
			const secret1 = 'secret-1';
			const secret2 = 'secret-2';

			const signature = crypto
				.createHmac('sha256', secret1)
				.update(payload)
				.digest('hex');

			const isValid = manager.verifySignature(payload, signature, secret2);

			expect(isValid).toBe(false);
		});
	});

	describe('sendOutbound', () => {
		it('should skip sending when webhook system is disabled', async () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'webhook.enabled') return false;
				if (key === 'webhook.maxRetries') return 3;
				if (key === 'webhook.secret') return 'global-secret';
				return undefined;
			});

			const disabledManager = new WebhookManager();

			await disabledManager.sendOutbound('trade_executed', { test: 'data' });

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('should send to matching outbound webhooks', async () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Trade Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["trade_executed"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);
			mockDb.get.mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'trade_executed',
				payload: '{}',
				statusCode: 200,
				response: 'OK',
				createdAt: '2024-01-01T00:00:00Z',
			});

			fetchMock.mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => 'OK',
			});

			await manager.sendOutbound('trade_executed', { symbol: 'AAPL' });

			expect(fetchMock).toHaveBeenCalledWith(
				'https://example.com/webhook',
				expect.objectContaining({
					method: 'POST',
					headers: expect.objectContaining({
						'Content-Type': 'application/json',
						'X-Signature': expect.any(String),
					}),
				}),
			);
		});

		it('should skip webhooks without matching event types', async () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Alert Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["alert"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);

			await manager.sendOutbound('trade_executed', { test: 'data' });

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('should send to webhooks with no event type filter', async () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Catch-all Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);
			mockDb.get.mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'custom',
				payload: '{}',
				statusCode: 200,
				response: 'OK',
				createdAt: '2024-01-01T00:00:00Z',
			});

			fetchMock.mockResolvedValue({
				ok: true,
				status: 200,
				text: async () => 'OK',
			});

			await manager.sendOutbound('custom', { test: 'data' });

			expect(fetchMock).toHaveBeenCalled();
		});

		it('should skip webhooks without URL', async () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'No URL Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["trade_executed"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);

			await manager.sendOutbound('trade_executed', { test: 'data' });

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('should retry on failure with exponential backoff', async () => {
			vi.useFakeTimers();

			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Retry Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["alert"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);
			mockDb.get.mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'alert',
				payload: '{}',
				statusCode: 500,
				response: 'Internal Server Error',
				createdAt: '2024-01-01T00:00:00Z',
			});

			fetchMock
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: async () => 'Internal Server Error',
				})
				.mockResolvedValueOnce({
					ok: false,
					status: 500,
					text: async () => 'Internal Server Error',
				})
				.mockResolvedValueOnce({
					ok: true,
					status: 200,
					text: async () => 'OK',
				});

			const promise = manager.sendOutbound('alert', { message: 'test' });

			// Fast-forward through retries
			await vi.runAllTimersAsync();
			await promise;

			expect(fetchMock).toHaveBeenCalledTimes(3);

			vi.useRealTimers();
		});

		it('should log failed attempts after all retries', async () => {
			vi.useFakeTimers();

			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Failed Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["alert"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);
			mockDb.get.mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'alert',
				payload: '{}',
				statusCode: 500,
				response: 'Error',
				createdAt: '2024-01-01T00:00:00Z',
			});

			fetchMock.mockResolvedValue({
				ok: false,
				status: 500,
				text: async () => 'Error',
			});

			const promise = manager.sendOutbound('alert', { message: 'test' });

			await vi.runAllTimersAsync();
			await promise;

			expect(fetchMock).toHaveBeenCalledTimes(3); // maxRetries = 3

			vi.useRealTimers();
		});

		it('should handle network errors', async () => {
			vi.useFakeTimers();

			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Network Error Webhook',
				url: 'https://example.com/webhook',
				secret: 'webhook-secret',
				direction: 'outbound',
				eventTypes: '["alert"]',
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.all.mockReturnValue([mockWebhook]);
			mockDb.get.mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'outbound',
				eventType: 'alert',
				payload: '{}',
				statusCode: 0,
				response: 'Network error',
				createdAt: '2024-01-01T00:00:00Z',
			});

			fetchMock.mockRejectedValue(new Error('Network error'));

			const promise = manager.sendOutbound('alert', { message: 'test' });

			await vi.runAllTimersAsync();
			await promise;

			expect(fetchMock).toHaveBeenCalledTimes(3);
			expect(mockDb.insert).toHaveBeenCalled();

			vi.useRealTimers();
		});
	});

	describe('processInbound', () => {
		it('should reject when webhook system is disabled', () => {
			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'webhook.enabled') return false;
				if (key === 'webhook.maxRetries') return 3;
				if (key === 'webhook.secret') return 'global-secret';
				return undefined;
			});

			const disabledManager = new WebhookManager();

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const result = disabledManager.processInbound(
				1,
				JSON.stringify(payload),
				'signature',
			);

			expect(result).toBeNull();
		});

		it('should reject when webhook not found', () => {
			mockDb.get.mockReturnValue(null);

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const result = manager.processInbound(
				999,
				JSON.stringify(payload),
				'signature',
			);

			expect(result).toBeNull();
		});

		it('should reject when webhook is inactive', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Inactive Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'inbound',
				eventTypes: null,
				active: false,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'unknown',
				payload: null,
				statusCode: 403,
				response: 'Webhook inactive',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const result = manager.processInbound(
				1,
				JSON.stringify(payload),
				'signature',
			);

			expect(result).toBeNull();
		});

		it('should reject when no secret configured', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'No Secret Webhook',
				url: null,
				secret: null,
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			vi.mocked(configManager.get).mockImplementation((key: string) => {
				if (key === 'webhook.enabled') return true;
				if (key === 'webhook.maxRetries') return 3;
				if (key === 'webhook.secret') return '';
				return undefined;
			});

			const noSecretManager = new WebhookManager();

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'unknown',
				payload: null,
				statusCode: 500,
				response: 'No secret configured',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const result = noSecretManager.processInbound(
				1,
				JSON.stringify(payload),
				'signature',
			);

			expect(result).toBeNull();
		});

		it('should reject invalid signature', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'unknown',
				payload: null,
				statusCode: 401,
				response: 'Invalid signature',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const result = manager.processInbound(
				1,
				JSON.stringify(payload),
				'invalid-signature',
			);

			expect(result).toBeNull();
		});

		it('should reject malformed JSON', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'unknown',
				payload: null,
				statusCode: 400,
				response: 'Invalid JSON',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const invalidJson = 'not valid json{';
			const signature = crypto
				.createHmac('sha256', 'webhook-secret')
				.update(invalidJson)
				.digest('hex');

			const result = manager.processInbound(1, invalidJson, signature);

			expect(result).toBeNull();
		});

		it('should reject payload missing required fields', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'unknown',
				payload: { data: 'test' },
				statusCode: 400,
				response: 'Missing required fields',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const invalidPayload = JSON.stringify({ data: 'test' }); // Missing eventType and timestamp
			const signature = crypto
				.createHmac('sha256', 'webhook-secret')
				.update(invalidPayload)
				.digest('hex');

			const result = manager.processInbound(1, invalidPayload, signature);

			expect(result).toBeNull();
		});

		it('should process valid inbound webhook', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: null,
				secret: 'webhook-secret',
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'custom',
				payload: '{"eventType":"custom","timestamp":"2024-01-01T00:00:00Z","data":{"test":"data"}}',
				statusCode: 200,
				response: 'OK',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const payload: WebhookPayload = {
				eventType: 'custom',
				timestamp: '2024-01-01T00:00:00Z',
				data: { test: 'data' },
			};

			const payloadString = JSON.stringify(payload);
			const signature = crypto
				.createHmac('sha256', 'webhook-secret')
				.update(payloadString)
				.digest('hex');

			const result = manager.processInbound(1, payloadString, signature);

			expect(result).toEqual(payload);
		});

		it('should use global secret when webhook has no secret', () => {
			const mockWebhook: WebhookConfig = {
				id: 1,
				name: 'Test Webhook',
				url: null,
				secret: null,
				direction: 'inbound',
				eventTypes: null,
				active: true,
				createdAt: '2024-01-01T00:00:00Z',
			};

			mockDb.get.mockReturnValueOnce(mockWebhook).mockReturnValue({
				id: 1,
				webhookId: 1,
				direction: 'inbound',
				eventType: 'alert',
				payload: '{"eventType":"alert","timestamp":"2024-01-01T00:00:00Z","data":{"message":"test"}}',
				statusCode: 200,
				response: 'OK',
				createdAt: '2024-01-01T00:00:00Z',
			});

			const payload: WebhookPayload = {
				eventType: 'alert',
				timestamp: '2024-01-01T00:00:00Z',
				data: { message: 'test' },
			};

			const payloadString = JSON.stringify(payload);
			const signature = crypto
				.createHmac('sha256', 'global-secret')
				.update(payloadString)
				.digest('hex');

			const result = manager.processInbound(1, payloadString, signature);

			expect(result).toEqual(payload);
		});
	});

	describe('getStatus', () => {
		it('should return webhook system status', () => {
			const mockInboundWebhooks: WebhookConfig[] = [
				{
					id: 1,
					name: 'Inbound 1',
					url: null,
					secret: 'secret',
					direction: 'inbound',
					eventTypes: null,
					active: true,
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			const mockOutboundWebhooks: WebhookConfig[] = [
				{
					id: 2,
					name: 'Outbound 1',
					url: 'https://example.com',
					secret: 'secret',
					direction: 'outbound',
					eventTypes: null,
					active: true,
					createdAt: '2024-01-01T00:00:00Z',
				},
				{
					id: 3,
					name: 'Outbound 2',
					url: 'https://example.com',
					secret: 'secret',
					direction: 'outbound',
					eventTypes: null,
					active: true,
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			const mockLogs: WebhookLog[] = [
				{
					id: 1,
					webhookId: 1,
					direction: 'inbound',
					eventType: 'custom',
					payload: '{}',
					statusCode: 200,
					response: 'OK',
					createdAt: '2024-01-01T00:00:00Z',
				},
			];

			mockDb.all
				.mockReturnValueOnce(mockInboundWebhooks)
				.mockReturnValueOnce(mockOutboundWebhooks)
				.mockReturnValueOnce(mockLogs);

			const status = manager.getStatus();

			expect(status).toEqual({
				enabled: true,
				activeInbound: 1,
				activeOutbound: 2,
				recentLogs: 1,
			});
		});
	});

	describe('getWebhookManager singleton', () => {
		it('should return same instance on multiple calls', () => {
			const instance1 = getWebhookManager();
			const instance2 = getWebhookManager();

			expect(instance1).toBe(instance2);
		});
	});
});
