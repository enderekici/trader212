import crypto from 'node:crypto';
import { configManager } from '../config/manager.js';
import {
  getActiveWebhooks,
  getWebhookById,
  getWebhookLogs,
  logWebhook,
  type WebhookConfig,
} from '../db/repositories/webhooks.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('webhook-manager');

export type WebhookEventType =
  | 'trade_executed'
  | 'signal_generated'
  | 'alert'
  | 'position_update'
  | 'custom';

export interface WebhookPayload {
  eventType: WebhookEventType;
  timestamp: string;
  data: unknown;
}

export interface WebhookStatus {
  enabled: boolean;
  activeInbound: number;
  activeOutbound: number;
  recentLogs: number;
}

let instance: WebhookManager | null = null;

export class WebhookManager {
  private enabled: boolean;
  private maxRetries: number;
  private globalSecret: string;

  constructor() {
    this.enabled = configManager.get<boolean>('webhook.enabled') ?? false;
    this.maxRetries = configManager.get<number>('webhook.maxRetries') ?? 3;
    this.globalSecret = configManager.get<string>('webhook.secret') ?? '';

    logger.info(
      { enabled: this.enabled, maxRetries: this.maxRetries },
      'WebhookManager initialized',
    );
  }

  /**
   * Generate HMAC-SHA256 signature for webhook payload
   */
  private generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verify HMAC-SHA256 signature
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    const expected = this.generateSignature(payload, secret);

    // Check length first to avoid timingSafeEqual error
    if (signature.length !== expected.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  /**
   * Send event to all outbound webhooks matching the event type
   */
  async sendOutbound(eventType: WebhookEventType, data: unknown): Promise<void> {
    if (!this.enabled) {
      logger.debug({ eventType }, 'Webhook system disabled, skipping outbound send');
      return;
    }

    const webhooks = getActiveWebhooks('outbound');
    const matchingWebhooks = webhooks.filter((webhook) => {
      if (!webhook.eventTypes) return true; // No filter = match all
      const types = JSON.parse(webhook.eventTypes) as string[];
      return types.includes(eventType);
    });

    if (matchingWebhooks.length === 0) {
      logger.debug({ eventType }, 'No matching outbound webhooks found');
      return;
    }

    const payload: WebhookPayload = {
      eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadString = JSON.stringify(payload);

    for (const webhook of matchingWebhooks) {
      if (!webhook.url) {
        logger.warn({ webhookId: webhook.id }, 'Webhook has no URL, skipping');
        continue;
      }

      await this.sendWithRetry(webhook, payloadString);
    }
  }

  /**
   * Send webhook with exponential backoff retry
   */
  private async sendWithRetry(webhook: WebhookConfig, payloadString: string): Promise<void> {
    const secret = webhook.secret || this.globalSecret;
    const signature = this.generateSignature(payloadString, secret);
    const url = webhook.url as string; // Guaranteed non-null by caller check

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': signature,
          },
          body: payloadString,
        });

        const responseText = await response.text();

        logWebhook({
          webhookId: webhook.id,
          direction: 'outbound',
          eventType: JSON.parse(payloadString).eventType,
          payload: JSON.parse(payloadString),
          statusCode: response.status,
          response: responseText,
        });

        if (response.ok) {
          logger.info(
            {
              webhookId: webhook.id,
              url: webhook.url,
              statusCode: response.status,
              attempt: attempt + 1,
            },
            'Webhook delivered successfully',
          );
          return;
        }

        logger.warn(
          {
            webhookId: webhook.id,
            url: webhook.url,
            statusCode: response.status,
            attempt: attempt + 1,
            response: responseText,
          },
          'Webhook delivery failed',
        );
      } catch (error) {
        logger.error(
          {
            error,
            webhookId: webhook.id,
            url: webhook.url,
            attempt: attempt + 1,
          },
          'Webhook request failed',
        );

        logWebhook({
          webhookId: webhook.id,
          direction: 'outbound',
          eventType: JSON.parse(payloadString).eventType,
          payload: JSON.parse(payloadString),
          statusCode: 0,
          response: error instanceof Error ? error.message : String(error),
        });
      }

      // Exponential backoff: 1s, 2s, 4s, etc.
      if (attempt < this.maxRetries - 1) {
        const delay = 1000 * 2 ** attempt;
        logger.debug(
          { webhookId: webhook.id, delay, attempt: attempt + 1 },
          'Retrying webhook delivery',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    logger.error(
      { webhookId: webhook.id, url: webhook.url, maxRetries: this.maxRetries },
      'Webhook delivery failed after all retries',
    );
  }

  /**
   * Process inbound webhook event
   */
  processInbound(webhookId: number, payload: string, signature: string): WebhookPayload | null {
    if (!this.enabled) {
      logger.debug('Webhook system disabled, rejecting inbound webhook');
      return null;
    }

    const webhook = getWebhookById(webhookId);
    if (!webhook) {
      logger.warn({ webhookId }, 'Webhook not found');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: undefined,
        statusCode: 404,
        response: 'Webhook not found',
      });
      return null;
    }

    if (!webhook.active) {
      logger.warn({ webhookId }, 'Webhook is inactive');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: undefined,
        statusCode: 403,
        response: 'Webhook inactive',
      });
      return null;
    }

    const secret = webhook.secret || this.globalSecret;
    if (!secret) {
      logger.error({ webhookId }, 'No secret configured for webhook');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: undefined,
        statusCode: 500,
        response: 'No secret configured',
      });
      return null;
    }

    // Verify signature
    if (!this.verifySignature(payload, signature, secret)) {
      logger.warn({ webhookId }, 'Invalid webhook signature');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: undefined,
        statusCode: 401,
        response: 'Invalid signature',
      });
      return null;
    }

    // Parse and validate payload
    let parsed: WebhookPayload;
    try {
      parsed = JSON.parse(payload) as WebhookPayload;
    } catch (error) {
      logger.error({ error, webhookId }, 'Failed to parse webhook payload');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: undefined,
        statusCode: 400,
        response: 'Invalid JSON',
      });
      return null;
    }

    if (!parsed.eventType || !parsed.timestamp) {
      logger.warn({ webhookId, parsed }, 'Invalid webhook payload structure');
      logWebhook({
        webhookId,
        direction: 'inbound',
        eventType: 'unknown',
        payload: parsed,
        statusCode: 400,
        response: 'Missing required fields',
      });
      return null;
    }

    logWebhook({
      webhookId,
      direction: 'inbound',
      eventType: parsed.eventType,
      payload: parsed,
      statusCode: 200,
      response: 'OK',
    });

    logger.info(
      { webhookId, eventType: parsed.eventType },
      'Inbound webhook processed successfully',
    );

    return parsed;
  }

  /**
   * Get webhook system status
   */
  getStatus(): WebhookStatus {
    const inboundWebhooks = getActiveWebhooks('inbound');
    const outboundWebhooks = getActiveWebhooks('outbound');
    const recentLogs = getWebhookLogs(undefined, 100);

    return {
      enabled: this.enabled,
      activeInbound: inboundWebhooks.length,
      activeOutbound: outboundWebhooks.length,
      recentLogs: recentLogs.length,
    };
  }
}

/**
 * Singleton factory for WebhookManager
 */
export function getWebhookManager(): WebhookManager {
  if (!instance) {
    instance = new WebhookManager();
  }
  return instance;
}
