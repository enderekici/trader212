import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('auth');

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health/status checks
  if (req.path === '/api/status' || req.path === '/api/health') {
    next();
    return;
  }

  const apiKey = process.env.API_SECRET_KEY?.trim();
  if (!apiKey) {
    // No key configured — auth disabled
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    log.warn({ path: req.path, ip: req.ip }, 'Unauthorized request — missing token');
    res.status(401).json({ error: 'Unauthorized: missing Bearer token' });
    return;
  }

  const token = authHeader.slice(7);
  const apiKeyBuf = Buffer.from(apiKey);
  const tokenBuf = Buffer.from(token);
  if (apiKeyBuf.length !== tokenBuf.length || !crypto.timingSafeEqual(apiKeyBuf, tokenBuf)) {
    log.warn({ path: req.path, ip: req.ip }, 'Unauthorized request — invalid token');
    res.status(401).json({ error: 'Unauthorized: invalid token' });
    return;
  }

  next();
}
