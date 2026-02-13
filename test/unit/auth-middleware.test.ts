import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { authMiddleware } from '../../src/api/middleware/auth.js';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    path: '/api/portfolio',
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.json = vi.fn(() => res);
  res.status = vi.fn(() => res);
  return res;
}

describe('authMiddleware', () => {
  const originalEnv = process.env.API_SECRET_KEY;

  beforeEach(() => {
    delete process.env.API_SECRET_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.API_SECRET_KEY = originalEnv;
    } else {
      delete process.env.API_SECRET_KEY;
    }
  });

  it('skips auth for /api/status health check', () => {
    process.env.API_SECRET_KEY = 'my-secret';
    const req = mockReq({ path: '/api/status' });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('skips auth when no API_SECRET_KEY is configured', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('skips auth when API_SECRET_KEY is empty string', () => {
    process.env.API_SECRET_KEY = '';
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('skips auth when API_SECRET_KEY is only whitespace', () => {
    process.env.API_SECRET_KEY = '   ';
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', () => {
    process.env.API_SECRET_KEY = 'my-secret';
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: missing Bearer token' });
  });

  it('returns 401 when Authorization header does not start with Bearer', () => {
    process.env.API_SECRET_KEY = 'my-secret';
    const req = mockReq({ headers: { authorization: 'Basic abc123' } });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: missing Bearer token' });
  });

  it('returns 401 when Bearer token does not match', () => {
    process.env.API_SECRET_KEY = 'my-secret';
    const req = mockReq({ headers: { authorization: 'Bearer wrong-token' } });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized: invalid token' });
  });

  it('calls next() when Bearer token matches', () => {
    process.env.API_SECRET_KEY = 'my-secret';
    const req = mockReq({ headers: { authorization: 'Bearer my-secret' } });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('trims whitespace from API_SECRET_KEY when comparing', () => {
    process.env.API_SECRET_KEY = '  my-secret  ';
    const req = mockReq({ headers: { authorization: 'Bearer my-secret' } });
    const res = mockRes();
    const next = vi.fn();

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
