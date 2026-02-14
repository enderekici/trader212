import express, { type Express } from 'express';
import { authMiddleware } from '../../../src/api/middleware/auth.js';
import { type BotCallbacks, createRouter, registerBotCallbacks } from '../../../src/api/routes.js';

export interface TestServerOptions {
  apiKey?: string;
  botCallbacks?: Partial<BotCallbacks>;
}

const defaultCallbacks: BotCallbacks = {
  getStatus: () => ({ paused: false, startedAt: new Date().toISOString() }),
  setPaused: () => {},
  closePosition: async (symbol) => `Closed ${symbol}`,
  analyzeSymbol: async (symbol) => `Analyzed ${symbol}`,
  refreshPairlist: async () => 'Pairlist refreshed',
  emergencyStop: async () => 'Emergency stop executed',
  getTradePlans: () => [],
  approveTradePlan: () => null,
  rejectTradePlan: () => {},
  runResearch: async () => null,
  getResearchReports: () => [],
  getModelStats: () => [],
};

/**
 * Creates a bare Express app for supertest integration testing.
 * No rate limiting (prevents flaky tests).
 */
export function createTestApp(options: TestServerOptions = {}): Express {
  if (options.apiKey) {
    process.env.API_SECRET_KEY = options.apiKey;
  } else {
    delete process.env.API_SECRET_KEY;
  }

  const cb: BotCallbacks = { ...defaultCallbacks, ...options.botCallbacks };
  registerBotCallbacks(cb);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);

  const router = createRouter();
  app.use(router);

  return app;
}
