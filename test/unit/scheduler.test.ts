import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock market-hours
const mockIsUSMarketOpen = vi.fn();
const mockGetMarketStatus = vi.fn();
vi.mock('../../src/utils/market-hours.js', () => ({
  isUSMarketOpen: (...args: unknown[]) => mockIsUSMarketOpen(...args),
  getMarketStatus: (...args: unknown[]) => mockGetMarketStatus(...args),
}));

// Mock node-cron
const mockStop = vi.fn();
const mockSchedule = vi.fn().mockReturnValue({ stop: mockStop });
vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => mockSchedule(...args),
  },
}));

import { Scheduler, minutesToWeekdayCron, timeToCron } from '../../src/bot/scheduler.js';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
    vi.clearAllMocks();
    mockIsUSMarketOpen.mockReturnValue(true);
    mockGetMarketStatus.mockReturnValue('open');
  });

  describe('registerJob', () => {
    it('registers a job and calls cron.schedule', () => {
      const handler = vi.fn();
      scheduler.registerJob('test-job', '*/5 * * * *', handler);

      expect(mockSchedule).toHaveBeenCalledTimes(1);
      expect(mockSchedule).toHaveBeenCalledWith(
        '*/5 * * * *',
        expect.any(Function),
        { timezone: 'America/New_York' },
      );
    });

    it('stores the job in the internal list', () => {
      scheduler.registerJob('job1', '*/5 * * * *', vi.fn());
      scheduler.registerJob('job2', '*/10 * * * *', vi.fn());

      const jobs = scheduler.getScheduledJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe('job1');
      expect(jobs[1].name).toBe('job2');
    });

    it('wrapped handler runs the original handler when market hours not required', async () => {
      const handler = vi.fn();
      scheduler.registerJob('test-job', '*/5 * * * *', handler, false);

      // Get the wrapped handler that was passed to cron.schedule
      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await wrappedHandler();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('wrapped handler runs when marketHoursOnly=true and market is open', async () => {
      mockIsUSMarketOpen.mockReturnValue(true);
      const handler = vi.fn();
      scheduler.registerJob('test-job', '*/5 * * * *', handler, true);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await wrappedHandler();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('wrapped handler skips when marketHoursOnly=true and market is closed', async () => {
      mockIsUSMarketOpen.mockReturnValue(false);
      mockGetMarketStatus.mockReturnValue('closed');
      const handler = vi.fn();
      scheduler.registerJob('test-job', '*/5 * * * *', handler, true);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await wrappedHandler();

      expect(handler).not.toHaveBeenCalled();
    });

    it('wrapped handler catches errors thrown by the handler', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      scheduler.registerJob('test-job', '*/5 * * * *', handler, false);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      // Should not throw
      await expect(wrappedHandler()).resolves.toBeUndefined();
    });

    it('calls onJobFailure callback when handler throws', async () => {
      const failureCb = vi.fn();
      scheduler.setOnJobFailure(failureCb);

      const error = new Error('handler error');
      const handler = vi.fn().mockRejectedValue(error);
      scheduler.registerJob('failing-job', '*/5 * * * *', handler, false);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await wrappedHandler();

      expect(failureCb).toHaveBeenCalledWith('failing-job', error);
    });

    it('silently catches errors from onJobFailure callback', async () => {
      const failureCb = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });
      scheduler.setOnJobFailure(failureCb);

      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      scheduler.registerJob('failing-job', '*/5 * * * *', handler, false);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      // Should not throw even when callback throws
      await expect(wrappedHandler()).resolves.toBeUndefined();
      expect(failureCb).toHaveBeenCalled();
    });

    it('does not call onJobFailure when no callback is set', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('handler error'));
      scheduler.registerJob('failing-job', '*/5 * * * *', handler, false);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      // Should not throw
      await expect(wrappedHandler()).resolves.toBeUndefined();
    });

    it('wrapped handler handles async handlers', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      scheduler.registerJob('async-job', '*/5 * * * *', handler, false);

      const wrappedHandler = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await wrappedHandler();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('defaults marketHoursOnly to false', () => {
      scheduler.registerJob('default-job', '*/5 * * * *', vi.fn());
      const jobs = scheduler.getScheduledJobs();
      expect(jobs[0].marketHoursOnly).toBe(false);
    });
  });

  describe('start', () => {
    it('logs that scheduler is running', () => {
      scheduler.registerJob('job1', '*/5 * * * *', vi.fn());
      // start() just logs, jobs auto-start via scheduled: true
      scheduler.start();
      // No assertion needed beyond verifying it doesn't throw
    });

    it('works with no jobs registered', () => {
      expect(() => scheduler.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('stops all scheduled tasks', () => {
      scheduler.registerJob('job1', '*/5 * * * *', vi.fn());
      scheduler.registerJob('job2', '*/10 * * * *', vi.fn());

      scheduler.stop();

      expect(mockStop).toHaveBeenCalledTimes(2);
    });

    it('clears the jobs list after stopping', () => {
      scheduler.registerJob('job1', '*/5 * * * *', vi.fn());
      scheduler.stop();

      expect(scheduler.getScheduledJobs()).toHaveLength(0);
    });

    it('works with no jobs', () => {
      expect(() => scheduler.stop()).not.toThrow();
      expect(scheduler.getScheduledJobs()).toHaveLength(0);
    });
  });

  describe('getScheduledJobs', () => {
    it('returns empty array when no jobs', () => {
      expect(scheduler.getScheduledJobs()).toEqual([]);
    });

    it('returns job details without the task reference', () => {
      scheduler.registerJob('my-job', '*/15 * * * 1-5', vi.fn(), true);
      const jobs = scheduler.getScheduledJobs();
      expect(jobs).toEqual([
        {
          name: 'my-job',
          schedule: '*/15 * * * 1-5',
          marketHoursOnly: true,
        },
      ]);
      // Ensure the task property is not exposed
      expect((jobs[0] as Record<string, unknown>).task).toBeUndefined();
    });
  });
});

describe('minutesToWeekdayCron', () => {
  it('converts 5 minutes to a weekday cron', () => {
    expect(minutesToWeekdayCron(5)).toBe('*/5 * * * 1-5');
  });

  it('converts 15 minutes to a weekday cron', () => {
    expect(minutesToWeekdayCron(15)).toBe('*/15 * * * 1-5');
  });

  it('converts 1 minute to a weekday cron', () => {
    expect(minutesToWeekdayCron(1)).toBe('*/1 * * * 1-5');
  });

  it('converts 60 minutes to a weekday cron', () => {
    expect(minutesToWeekdayCron(60)).toBe('*/60 * * * 1-5');
  });
});

describe('timeToCron', () => {
  it('converts "16:30" to a weekday cron', () => {
    expect(timeToCron('16:30')).toBe('30 16 * * 1-5');
  });

  it('converts "09:00" to a weekday cron', () => {
    expect(timeToCron('09:00')).toBe('0 9 * * 1-5');
  });

  it('converts "00:00" to a weekday cron', () => {
    expect(timeToCron('00:00')).toBe('0 0 * * 1-5');
  });

  it('converts with custom daysOfWeek', () => {
    expect(timeToCron('12:00', '*')).toBe('0 12 * * *');
  });

  it('converts with specific days', () => {
    expect(timeToCron('08:30', '1,3,5')).toBe('30 8 * * 1,3,5');
  });

  it('uses default daysOfWeek "1-5" when not specified', () => {
    expect(timeToCron('14:45')).toBe('45 14 * * 1-5');
  });
});
