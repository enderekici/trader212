import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock better-sqlite3 before importing the module under test
const mockExec = vi.fn();
const mockPragma = vi.fn();
const mockSqliteInstance = {
  exec: mockExec,
  pragma: mockPragma,
};
const MockDatabase = vi.fn(() => mockSqliteInstance);

vi.mock('node:module', () => ({
  createRequire: () => () => MockDatabase,
}));

const mockDrizzle = vi.fn(() => 'mock-drizzle-db');
vi.mock('drizzle-orm/better-sqlite3', () => ({
  drizzle: mockDrizzle,
}));

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../src/db/schema.js', () => ({
  __esModule: true,
  default: {},
}));

describe('db/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module so that `db` is undefined on every test
    vi.resetModules();
  });

  it('getDb throws if database not initialized', async () => {
    const mod = await import('../../src/db/index.js');
    expect(() => mod.getDb()).toThrow('Database not initialized');
  });

  it('initDatabase creates a SQLite database with the given path', async () => {
    const mod = await import('../../src/db/index.js');
    const result = mod.initDatabase('/tmp/test.db');
    expect(MockDatabase).toHaveBeenCalledWith('/tmp/test.db');
    expect(result).toBe('mock-drizzle-db');
  });

  it('initDatabase sets WAL mode and other pragmas', async () => {
    const mod = await import('../../src/db/index.js');
    mod.initDatabase('/tmp/test.db');
    expect(mockPragma).toHaveBeenCalledWith('journal_mode = WAL');
    expect(mockPragma).toHaveBeenCalledWith('busy_timeout = 5000');
    expect(mockPragma).toHaveBeenCalledWith('synchronous = NORMAL');
    expect(mockPragma).toHaveBeenCalledWith('foreign_keys = ON');
  });

  it('initDatabase calls exec to create tables', async () => {
    const mod = await import('../../src/db/index.js');
    mod.initDatabase('/tmp/test.db');
    expect(mockExec).toHaveBeenCalledTimes(1);
    const sql = mockExec.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trades');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS signals');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS positions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS price_cache');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS news_cache');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS earnings_calendar');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS insider_transactions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS fundamental_cache');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS daily_metrics');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pairlist_history');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS config');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trade_plans');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_research');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS model_performance');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_log');
  });

  it('initDatabase uses DB_PATH env var when no path provided', async () => {
    process.env.DB_PATH = '/env/test.db';
    const mod = await import('../../src/db/index.js');
    mod.initDatabase();
    expect(MockDatabase).toHaveBeenCalledWith('/env/test.db');
    delete process.env.DB_PATH;
  });

  it('initDatabase uses default path when no path or env var provided', async () => {
    delete process.env.DB_PATH;
    const mod = await import('../../src/db/index.js');
    mod.initDatabase();
    expect(MockDatabase).toHaveBeenCalledWith('./data/trader212.db');
  });

  it('getDb returns database after initialization', async () => {
    const mod = await import('../../src/db/index.js');
    mod.initDatabase('/tmp/test.db');
    expect(mod.getDb()).toBe('mock-drizzle-db');
  });

  it('initDatabase passes drizzle the sqlite instance and schema', async () => {
    const mod = await import('../../src/db/index.js');
    mod.initDatabase('/tmp/test.db');
    expect(mockDrizzle).toHaveBeenCalledWith(mockSqliteInstance, expect.objectContaining({ schema: expect.any(Object) }));
  });

  it('creates indexes for price_cache, news_cache, earnings, insider, fundamental, trade_plans, ai_research, model_performance, and audit_log', async () => {
    const mod = await import('../../src/db/index.js');
    mod.initDatabase('/tmp/test.db');
    const sql = mockExec.mock.calls[0][0] as string;
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_price_symbol_ts');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_news_symbol');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_earnings_symbol');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_insider_symbol');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_fund_symbol');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_trade_plans_symbol');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_research_ts');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_model_perf');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_audit_ts');
  });
});
