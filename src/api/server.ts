import { type Server, createServer } from 'node:http';
import cors from 'cors';
import express, { type Express } from 'express';
import { createLogger } from '../utils/logger.js';
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
    this.app.use(
      cors({
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      }),
    );
    this.app.use(express.json());

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
