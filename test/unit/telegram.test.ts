import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mock node-telegram-bot-api ──────────────────────────────────────────────
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockOnText = vi.fn();
const mockStopPolling = vi.fn();

vi.mock('node-telegram-bot-api', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      sendMessage: mockSendMessage,
      onText: mockOnText,
      stopPolling: mockStopPolling,
    })),
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import SUT ──────────────────────────────────────────────────────────────
import { TelegramNotifier } from '../../src/monitoring/telegram.js';

describe('TelegramNotifier', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
    vi.clearAllMocks();
  });

  // ── Constructor ────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('initializes when both token and chatId are set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '12345';

      const notifier = new TelegramNotifier();
      expect(notifier).toBeDefined();
    });

    it('is disabled when token is missing', () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      process.env.TELEGRAM_CHAT_ID = '12345';

      const notifier = new TelegramNotifier();
      expect(notifier).toBeDefined();
    });

    it('is disabled when chatId is missing', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      delete process.env.TELEGRAM_CHAT_ID;

      const notifier = new TelegramNotifier();
      expect(notifier).toBeDefined();
    });
  });

  describe('with bot enabled', () => {
    let notifier: TelegramNotifier;

    beforeEach(() => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.TELEGRAM_CHAT_ID = '12345';
      notifier = new TelegramNotifier();
    });

    // ── sendMessage ──────────────────────────────────────────────────────
    describe('sendMessage', () => {
      it('sends message with HTML parse mode', async () => {
        await notifier.sendMessage('Hello world');

        expect(mockSendMessage).toHaveBeenCalledWith('12345', 'Hello world', {
          parse_mode: 'HTML',
        });
      });

      it('handles send error gracefully', async () => {
        mockSendMessage.mockRejectedValueOnce(new Error('Network error'));

        await expect(notifier.sendMessage('test')).resolves.not.toThrow();
      });
    });

    // ── sendAlert ────────────────────────────────────────────────────────
    describe('sendAlert', () => {
      it('sends formatted alert', async () => {
        await notifier.sendAlert('Daily Loss', 'Portfolio down 5%');

        expect(mockSendMessage).toHaveBeenCalledWith(
          '12345',
          expect.stringContaining('Daily Loss'),
          expect.any(Object),
        );
      });
    });

    // ── sendTradeNotification ────────────────────────────────────────────
    describe('sendTradeNotification', () => {
      it('sends BUY notification with stop loss and reasoning', async () => {
        await notifier.sendTradeNotification({
          symbol: 'AAPL',
          side: 'BUY',
          shares: 10,
          price: 150.50,
          stopLoss: 142.97,
          reasoning: 'Strong breakout',
        });

        expect(mockSendMessage).toHaveBeenCalledWith(
          '12345',
          expect.stringContaining('BUY AAPL'),
          expect.any(Object),
        );
        expect(mockSendMessage).toHaveBeenCalledWith(
          '12345',
          expect.stringContaining('Stop Loss: $142.97'),
          expect.any(Object),
        );
        expect(mockSendMessage).toHaveBeenCalledWith(
          '12345',
          expect.stringContaining('Strong breakout'),
          expect.any(Object),
        );
      });

      it('sends SELL notification without stop loss', async () => {
        await notifier.sendTradeNotification({
          symbol: 'GOOG',
          side: 'SELL',
          shares: 5,
          price: 2800.00,
        });

        expect(mockSendMessage).toHaveBeenCalledWith(
          '12345',
          expect.stringContaining('SELL GOOG'),
          expect.any(Object),
        );
      });

      it('handles notification without reasoning', async () => {
        await notifier.sendTradeNotification({
          symbol: 'AAPL',
          side: 'BUY',
          shares: 10,
          price: 150.50,
        });

        expect(mockSendMessage).toHaveBeenCalledOnce();
      });
    });

    // ── registerCommands ─────────────────────────────────────────────────
    describe('registerCommands', () => {
      const handlers = {
        onStatus: vi.fn().mockResolvedValue('Bot running'),
        onPause: vi.fn().mockResolvedValue('Paused'),
        onResume: vi.fn().mockResolvedValue('Resumed'),
        onClose: vi.fn().mockResolvedValue('Closed'),
        onPositions: vi.fn().mockResolvedValue('No positions'),
        onPerformance: vi.fn().mockResolvedValue('All time: 5%'),
        onPairlist: vi.fn().mockResolvedValue('10 stocks'),
      };

      it('registers all command handlers', () => {
        notifier.registerCommands(handlers);

        // 8 commands registered: status, pause, resume, close, positions, performance, pairlist, help
        expect(mockOnText).toHaveBeenCalledTimes(8);
      });

      it('/status command calls handler and sends response', async () => {
        notifier.registerCommands(handlers);

        // Find the /status callback
        const statusCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/status/),
        );
        const callback = statusCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onStatus).toHaveBeenCalled();
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Bot running', { parse_mode: 'HTML' });
      });

      it('/status command handles error', async () => {
        handlers.onStatus.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const statusCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/status/),
        );
        const callback = statusCall[1];

        await callback({ chat: { id: 99 } });

        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error fetching status.');
      });

      it('/pause command calls handler', async () => {
        notifier.registerCommands(handlers);

        const pauseCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/pause/),
        );
        const callback = pauseCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onPause).toHaveBeenCalled();
      });

      it('/pause command handles error', async () => {
        handlers.onPause.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const pauseCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/pause/),
        );
        const callback = pauseCall[1];

        await callback({ chat: { id: 99 } });
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error pausing bot.');
      });

      it('/resume command calls handler', async () => {
        notifier.registerCommands(handlers);

        const resumeCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/resume/),
        );
        const callback = resumeCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onResume).toHaveBeenCalled();
      });

      it('/resume command handles error', async () => {
        handlers.onResume.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const resumeCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/resume/),
        );
        const callback = resumeCall[1];

        await callback({ chat: { id: 99 } });
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error resuming bot.');
      });

      it('/close command sends usage when no ticker', async () => {
        notifier.registerCommands(handlers);

        const closeCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/close(?:\s+(.+))?/),
        );
        const callback = closeCall[1];

        // No match group
        await callback({ chat: { id: 99 } }, ['/close', undefined]);

        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Usage: /close <TICKER>');
        expect(handlers.onClose).not.toHaveBeenCalled();
      });

      it('/close command calls handler with uppercase ticker', async () => {
        notifier.registerCommands(handlers);

        const closeCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/close(?:\s+(.+))?/),
        );
        const callback = closeCall[1];

        await callback({ chat: { id: 99 } }, ['/close aapl', 'aapl']);

        expect(handlers.onClose).toHaveBeenCalledWith('AAPL');
      });

      it('/close command handles error', async () => {
        handlers.onClose.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const closeCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/close(?:\s+(.+))?/),
        );
        const callback = closeCall[1];

        await callback({ chat: { id: 99 } }, ['/close MSFT', 'MSFT']);

        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error closing position for MSFT.');
      });

      it('/positions command calls handler', async () => {
        notifier.registerCommands(handlers);

        const posCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/positions/),
        );
        const callback = posCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onPositions).toHaveBeenCalled();
      });

      it('/positions command handles error', async () => {
        handlers.onPositions.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const posCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/positions/),
        );
        const callback = posCall[1];

        await callback({ chat: { id: 99 } });
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error fetching positions.');
      });

      it('/performance command calls handler', async () => {
        notifier.registerCommands(handlers);

        const perfCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/performance/),
        );
        const callback = perfCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onPerformance).toHaveBeenCalled();
      });

      it('/performance command handles error', async () => {
        handlers.onPerformance.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const perfCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/performance/),
        );
        const callback = perfCall[1];

        await callback({ chat: { id: 99 } });
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error fetching performance.');
      });

      it('/pairlist command calls handler', async () => {
        notifier.registerCommands(handlers);

        const pairCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/pairlist/),
        );
        const callback = pairCall[1];

        await callback({ chat: { id: 99 } });

        expect(handlers.onPairlist).toHaveBeenCalled();
      });

      it('/pairlist command handles error', async () => {
        handlers.onPairlist.mockRejectedValueOnce(new Error('fail'));
        notifier.registerCommands(handlers);

        const pairCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/pairlist/),
        );
        const callback = pairCall[1];

        await callback({ chat: { id: 99 } });
        expect(mockSendMessage).toHaveBeenCalledWith(99, 'Error fetching pairlist.');
      });

      it('/help command sends help text', async () => {
        notifier.registerCommands(handlers);

        const helpCall = mockOnText.mock.calls.find(
          (call: unknown[]) => String(call[0]) === String(/\/help/),
        );
        const callback = helpCall[1];

        await callback({ chat: { id: 99 } });

        expect(mockSendMessage).toHaveBeenCalledWith(
          99,
          expect.stringContaining('Trading Bot Commands'),
          { parse_mode: 'HTML' },
        );
      });
    });

    // ── stop ─────────────────────────────────────────────────────────────
    describe('stop', () => {
      it('stops polling', () => {
        notifier.stop();
        expect(mockStopPolling).toHaveBeenCalled();
      });
    });
  });

  describe('with bot disabled', () => {
    let notifier: TelegramNotifier;

    beforeEach(() => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
      notifier = new TelegramNotifier();
    });

    it('sendMessage does nothing', async () => {
      await notifier.sendMessage('test');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sendAlert does nothing', async () => {
      await notifier.sendAlert('Alert', 'Body');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('registerCommands does nothing', () => {
      notifier.registerCommands({
        onStatus: vi.fn().mockResolvedValue(''),
        onPause: vi.fn().mockResolvedValue(''),
        onResume: vi.fn().mockResolvedValue(''),
        onClose: vi.fn().mockResolvedValue(''),
        onPositions: vi.fn().mockResolvedValue(''),
        onPerformance: vi.fn().mockResolvedValue(''),
        onPairlist: vi.fn().mockResolvedValue(''),
      });
      expect(mockOnText).not.toHaveBeenCalled();
    });

    it('stop does nothing', () => {
      notifier.stop();
      expect(mockStopPolling).not.toHaveBeenCalled();
    });
  });
});
