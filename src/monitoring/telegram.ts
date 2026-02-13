import TelegramBot from 'node-telegram-bot-api';
import { createLogger } from '../utils/logger.js';

const log = createLogger('telegram');

export interface TelegramCommandHandlers {
  onStatus: () => Promise<string>;
  onPause: () => Promise<string>;
  onResume: () => Promise<string>;
  onClose: (ticker: string) => Promise<string>;
  onPositions: () => Promise<string>;
  onPerformance: () => Promise<string>;
  onPairlist: () => Promise<string>;
}

export class TelegramNotifier {
  private bot: TelegramBot | null = null;
  private chatId: string | null;
  private enabled: boolean;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = process.env.TELEGRAM_CHAT_ID ?? null;
    this.enabled = !!token && !!this.chatId;

    if (!token) {
      log.warn('TELEGRAM_BOT_TOKEN not set — Telegram notifications disabled');
      return;
    }
    if (!this.chatId) {
      log.warn('TELEGRAM_CHAT_ID not set — Telegram notifications disabled');
      return;
    }

    this.bot = new TelegramBot(token, { polling: true });
    log.info('Telegram bot initialized');
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.bot || !this.chatId) return;
    try {
      await this.bot.sendMessage(this.chatId, text, { parse_mode: 'HTML' });
    } catch (err) {
      log.error({ err }, 'Failed to send Telegram message');
    }
  }

  async sendAlert(title: string, body: string): Promise<void> {
    const text = `<b>⚠️ ${title}</b>\n\n${body}`;
    await this.sendMessage(text);
  }

  async sendTradeNotification(trade: {
    symbol: string;
    side: string;
    shares: number;
    price: number;
    stopLoss?: number;
    reasoning?: string;
  }): Promise<void> {
    const emoji = trade.side === 'BUY' ? '🟢' : '🔴';
    const lines = [
      `${emoji} <b>${trade.side} ${trade.symbol}</b>`,
      `Shares: ${trade.shares}`,
      `Price: $${trade.price.toFixed(2)}`,
    ];
    if (trade.stopLoss != null) {
      lines.push(`Stop Loss: $${trade.stopLoss.toFixed(2)}`);
    }
    if (trade.reasoning) {
      lines.push(`\nReasoning: <i>${trade.reasoning}</i>`);
    }
    await this.sendMessage(lines.join('\n'));
  }

  registerCommands(handlers: TelegramCommandHandlers): void {
    if (!this.bot) return;

    this.bot.onText(/\/status/, async (msg) => {
      try {
        const response = await handlers.onStatus();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/status command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error fetching status.');
      }
    });

    this.bot.onText(/\/pause/, async (msg) => {
      try {
        const response = await handlers.onPause();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/pause command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error pausing bot.');
      }
    });

    this.bot.onText(/\/resume/, async (msg) => {
      try {
        const response = await handlers.onResume();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/resume command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error resuming bot.');
      }
    });

    this.bot.onText(/\/close(?:\s+(.+))?/, async (msg, match) => {
      const ticker = match?.[1]?.trim().toUpperCase();
      if (!ticker) {
        await this.bot?.sendMessage(msg.chat.id, 'Usage: /close <TICKER>');
        return;
      }
      try {
        const response = await handlers.onClose(ticker);
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err, ticker }, '/close command failed');
        await this.bot?.sendMessage(msg.chat.id, `Error closing position for ${ticker}.`);
      }
    });

    this.bot.onText(/\/positions/, async (msg) => {
      try {
        const response = await handlers.onPositions();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/positions command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error fetching positions.');
      }
    });

    this.bot.onText(/\/performance/, async (msg) => {
      try {
        const response = await handlers.onPerformance();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/performance command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error fetching performance.');
      }
    });

    this.bot.onText(/\/pairlist/, async (msg) => {
      try {
        const response = await handlers.onPairlist();
        await this.bot?.sendMessage(msg.chat.id, response, { parse_mode: 'HTML' });
      } catch (err) {
        log.error({ err }, '/pairlist command failed');
        await this.bot?.sendMessage(msg.chat.id, 'Error fetching pairlist.');
      }
    });

    this.bot.onText(/\/help/, async (msg) => {
      const helpText = [
        '<b>Trading Bot Commands:</b>',
        '/status - Bot status &amp; portfolio',
        '/positions - Open positions',
        '/performance - Performance metrics',
        '/pairlist - Active stock list',
        '/pause - Pause trading',
        '/resume - Resume trading',
        '/close &lt;TICKER&gt; - Close a position',
        '/help - Show this message',
      ].join('\n');
      await this.bot?.sendMessage(msg.chat.id, helpText, { parse_mode: 'HTML' });
    });

    log.info('Telegram commands registered');
  }

  stop(): void {
    if (!this.bot) return;
    this.bot.stopPolling();
    log.info('Telegram bot stopped');
  }
}
