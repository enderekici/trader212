import { test, expect } from '@playwright/test';

// Mock responses matching the frontend's expected types
const MOCK_STATUS = {
  status: 'running',
  uptime: 3600,
  startedAt: '2026-02-14T10:00:00Z',
  dryRun: true,
  marketStatus: 'closed',
  accountType: 'INVEST',
  environment: 'demo',
  marketTimes: {
    currentTimeET: '2026-02-14T17:00:00',
    currentTimeUTC: '2026-02-14T22:00:00Z',
    marketStatus: 'closed',
    nextOpen: '2026-02-15T09:30:00',
    nextClose: null,
    countdownMinutes: 0,
    isHoliday: false,
    isEarlyClose: false,
  },
};

const MOCK_PORTFOLIO = {
  positions: [],
  cashAvailable: 10000,
  totalValue: 10000,
  pnl: 0,
};

const MOCK_TRADES = { trades: [], total: 0 };
const MOCK_SIGNALS = { signals: [], total: 0 };
const MOCK_PERFORMANCE = {
  winRate: 0,
  totalTrades: 0,
  totalPnl: 0,
  sharpeRatio: 0,
  maxDrawdown: 0,
  avgReturn: 0,
  profitFactor: 0,
};
const MOCK_DAILY_METRICS = { metrics: [] };
const MOCK_CONFIG = {};
const MOCK_PAIRLIST = { stocks: [], lastRefreshed: null };
const MOCK_PAIRLIST_HISTORY = { history: [] };
const MOCK_RESEARCH = { reports: [] };
const MOCK_AUDIT = { entries: [] };
const MOCK_MODEL_STATS = { stats: [] };
const MOCK_ORDERS = { orders: [], total: 0 };
const MOCK_TRADE_PLANS = { plans: [] };
const MOCK_CORRELATION = { symbols: [], matrix: [] };

function mockApiRoute(url: string): object {
  const path = new URL(url).pathname;

  if (path === '/api/status') return MOCK_STATUS;
  if (path === '/api/portfolio') return MOCK_PORTFOLIO;
  if (path === '/api/performance/daily') return MOCK_DAILY_METRICS;
  if (path === '/api/performance') return MOCK_PERFORMANCE;
  if (path.startsWith('/api/trades')) return MOCK_TRADES;
  if (path.startsWith('/api/signals')) return MOCK_SIGNALS;
  if (path.startsWith('/api/config')) return MOCK_CONFIG;
  if (path === '/api/pairlist/history') return MOCK_PAIRLIST_HISTORY;
  if (path === '/api/pairlist') return MOCK_PAIRLIST;
  if (path === '/api/research') return MOCK_RESEARCH;
  if (path === '/api/audit') return MOCK_AUDIT;
  if (path === '/api/model-stats') return MOCK_MODEL_STATS;
  if (path === '/api/orders') return MOCK_ORDERS;
  if (path === '/api/trade-plans') return MOCK_TRADE_PLANS;
  if (path === '/api/correlation') return MOCK_CORRELATION;

  return {};
}

test.describe('Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept all API calls with mock responses
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      const json = mockApiRoute(url);
      await route.fulfill({ json });
    });
  });

  test('Dashboard loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    // Sidebar should be visible with Trader212 branding
    await expect(page.locator('text=Trader212')).toBeVisible();
    // Dashboard heading
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible();
    // Stat cards
    await expect(page.locator('text=Portfolio Value')).toBeVisible();
    await expect(page.locator('text=Cash Available')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Positions page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/positions');
    await expect(page.locator('h1:has-text("Positions")')).toBeVisible();
    await expect(page.locator('text=No open positions')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Trades page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/trades');
    await expect(page.locator('h1:has-text("Trade History")')).toBeVisible();
    await expect(page.locator('text=No trades found')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Signals page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/signals');
    await expect(page.locator('h1:has-text("Signals")')).toBeVisible();
    await expect(page.locator('text=No signals generated yet')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Pairlist page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/pairlist');
    await expect(page.locator('h1:has-text("Pairlist")')).toBeVisible();
    await expect(page.locator('text=Active Pairlist')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Research page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/research');
    await expect(page.locator('h1:has-text("AI Market Research")')).toBeVisible();
    await expect(page.locator('text=Run New Research')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Analytics page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/analytics');
    await expect(page.locator('h1:has-text("Analytics")')).toBeVisible();
    // Metric cards
    await expect(page.locator('text=Total P&L').first()).toBeVisible();
    await expect(page.locator('text=Total Trades')).toBeVisible();
    await expect(page.locator('text=Max Drawdown')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Audit page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/audit');
    await expect(page.locator('h1:has-text("Activity Log")')).toBeVisible();
    // Filter buttons should be visible
    await expect(page.locator('text=No events found')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Settings page loads without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/settings');
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await expect(page.locator('text=Configure all bot parameters')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('Sidebar navigation links are present', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav');
    await expect(nav).toBeVisible();

    // Check all 9 navigation items exist
    await expect(nav.locator('text=Overview')).toBeVisible();
    await expect(nav.locator('text=Positions')).toBeVisible();
    await expect(nav.locator('text=Trades')).toBeVisible();
    await expect(nav.locator('text=Signals')).toBeVisible();
    await expect(nav.locator('text=Pairlist')).toBeVisible();
    await expect(nav.locator('text=Research')).toBeVisible();
    await expect(nav.locator('text=Analytics')).toBeVisible();
    await expect(nav.locator('text=Activity')).toBeVisible();
    await expect(nav.locator('text=Settings')).toBeVisible();
  });
});
