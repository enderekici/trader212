import { and, desc, eq } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';
import { getDb } from '../index.js';
import { webhookConfigs, webhookLogs } from '../schema.js';

const logger = createLogger('webhooks-repository');

export interface WebhookConfig {
  id: number;
  name: string;
  url: string | null;
  secret: string | null;
  direction: 'inbound' | 'outbound';
  eventTypes: string | null;
  active: boolean;
  createdAt: string;
}

export interface WebhookLog {
  id: number;
  webhookId: number | null;
  direction: 'inbound' | 'outbound';
  eventType: string;
  payload: string | null;
  statusCode: number | null;
  response: string | null;
  createdAt: string;
}

export interface CreateWebhookData {
  name: string;
  url: string | null;
  secret: string | null;
  direction: 'inbound' | 'outbound';
  eventTypes?: string[];
  active?: boolean;
}

export interface UpdateWebhookData {
  name?: string;
  url?: string | null;
  secret?: string | null;
  eventTypes?: string[];
  active?: boolean;
}

export interface LogWebhookData {
  webhookId?: number;
  direction: 'inbound' | 'outbound';
  eventType: string;
  payload?: unknown;
  statusCode?: number;
  response?: string;
}

/**
 * Get active webhook configurations, optionally filtered by direction
 */
export function getActiveWebhooks(direction?: 'inbound' | 'outbound'): WebhookConfig[] {
  const db = getDb();

  try {
    const conditions = direction
      ? and(eq(webhookConfigs.active, true), eq(webhookConfigs.direction, direction))
      : eq(webhookConfigs.active, true);
    const results = db.select().from(webhookConfigs).where(conditions).all();
    return results as WebhookConfig[];
  } catch (error) {
    logger.error({ error, direction }, 'Failed to get active webhooks');
    return [];
  }
}

/**
 * Get a single webhook configuration by ID
 */
export function getWebhookById(id: number): WebhookConfig | null {
  const db = getDb();

  try {
    const result = db.select().from(webhookConfigs).where(eq(webhookConfigs.id, id)).get();

    return (result as WebhookConfig) || null;
  } catch (error) {
    logger.error({ error, id }, 'Failed to get webhook by ID');
    return null;
  }
}

/**
 * Create a new webhook configuration
 */
export function createWebhook(data: CreateWebhookData): WebhookConfig | null {
  const db = getDb();

  try {
    const result = db
      .insert(webhookConfigs)
      .values({
        name: data.name,
        url: data.url,
        secret: data.secret,
        direction: data.direction,
        eventTypes: data.eventTypes ? JSON.stringify(data.eventTypes) : null,
        active: data.active ?? true,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();

    logger.info({ webhookId: result.id, name: data.name }, 'Created webhook');
    return result as WebhookConfig;
  } catch (error) {
    logger.error({ error, data }, 'Failed to create webhook');
    return null;
  }
}

/**
 * Update an existing webhook configuration
 */
export function updateWebhook(id: number, data: UpdateWebhookData): WebhookConfig | null {
  const db = getDb();

  try {
    const updates: Record<string, unknown> = {};

    if (data.name !== undefined) updates.name = data.name;
    if (data.url !== undefined) updates.url = data.url;
    if (data.secret !== undefined) updates.secret = data.secret;
    if (data.active !== undefined) updates.active = data.active;
    if (data.eventTypes !== undefined) {
      updates.eventTypes = JSON.stringify(data.eventTypes);
    }

    const result = db
      .update(webhookConfigs)
      .set(updates)
      .where(eq(webhookConfigs.id, id))
      .returning()
      .get();

    logger.info({ webhookId: id, updates }, 'Updated webhook');
    return (result as WebhookConfig) || null;
  } catch (error) {
    logger.error({ error, id, data }, 'Failed to update webhook');
    return null;
  }
}

/**
 * Delete a webhook configuration
 */
export function deleteWebhook(id: number): boolean {
  const db = getDb();

  try {
    db.delete(webhookConfigs).where(eq(webhookConfigs.id, id)).run();
    logger.info({ webhookId: id }, 'Deleted webhook');
    return true;
  } catch (error) {
    logger.error({ error, id }, 'Failed to delete webhook');
    return false;
  }
}

/**
 * Log a webhook event (inbound or outbound)
 */
export function logWebhook(data: LogWebhookData): WebhookLog | null {
  const db = getDb();

  try {
    const result = db
      .insert(webhookLogs)
      .values({
        webhookId: data.webhookId ?? null,
        direction: data.direction,
        eventType: data.eventType,
        payload: data.payload ? JSON.stringify(data.payload) : null,
        statusCode: data.statusCode ?? null,
        response: data.response ?? null,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();

    return result as WebhookLog;
  } catch (error) {
    logger.error({ error, data }, 'Failed to log webhook event');
    return null;
  }
}

/**
 * Get webhook logs, optionally filtered by webhook ID
 */
export function getWebhookLogs(webhookId?: number, limit = 100): WebhookLog[] {
  const db = getDb();

  try {
    const condition = webhookId !== undefined ? eq(webhookLogs.webhookId, webhookId) : undefined;
    const results = condition
      ? db
          .select()
          .from(webhookLogs)
          .where(condition)
          .orderBy(desc(webhookLogs.createdAt))
          .limit(limit)
          .all()
      : db.select().from(webhookLogs).orderBy(desc(webhookLogs.createdAt)).limit(limit).all();
    return results as WebhookLog[];
  } catch (error) {
    logger.error({ error, webhookId, limit }, 'Failed to get webhook logs');
    return [];
  }
}
