import { createServer, type Server } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import { createLogger } from '../utils/logger.js';
import { authMiddleware } from './middleware/auth.js';
import { createRouter } from './routes.js';
import { WebSocketManager } from './websocket.js';

const log = createLogger('api-server');

export class ApiServer {
  private app: Express;
  private server: Server;
  private wsManager: WebSocketManager;
  private port: number;

  constructor() {
    this.port = Number(process.env.API_PORT) || 3001;
    this.app = express();

    // CORS whitelist
    const corsOrigins = process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
      : ['http://localhost:3000'];
    this.app.use(
      cors({
        origin: corsOrigins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      }),
    );
    this.app.use(express.json());

    // Authentication
    this.app.use(authMiddleware);

    // Rate limiting
    const generalLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
    });
    this.app.use(generalLimiter);

    const controlLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many control requests, please try again later' },
    });
    this.app.use('/api/control', controlLimiter);
    this.app.use('/api/config', controlLimiter);

    const router = createRouter();
    this.app.use(router);

    this.server = createServer(this.app);
    this.wsManager = new WebSocketManager(this.server);
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        log.info({ port: this.port }, 'API server started');
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsManager.close();
      this.server.close((err) => {
        if (err) reject(err);
        else {
          log.info('API server stopped');
          resolve();
        }
      });
    });
  }

  getWsManager(): WebSocketManager {
    return this.wsManager;
  }
}
