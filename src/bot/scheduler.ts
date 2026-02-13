import cron from 'node-cron';
import { createLogger } from '../utils/logger.js';
import { getMarketStatus, isUSMarketOpen } from '../utils/market-hours.js';

const log = createLogger('scheduler');

interface ScheduledJob {
  name: string;
  schedule: string;
  task: cron.ScheduledTask;
  marketHoursOnly: boolean;
}

export class Scheduler {
  private jobs: ScheduledJob[] = [];

  registerJob(
    name: string,
    cronExpression: string,
    handler: () => void | Promise<void>,
    marketHoursOnly = false,
  ): void {
    const wrappedHandler = async () => {
      if (marketHoursOnly && !isUSMarketOpen()) {
        log.debug({ job: name, marketStatus: getMarketStatus() }, 'Skipping job — market closed');
        return;
      }
      try {
        log.debug({ job: name }, 'Running scheduled job');
        await handler();
      } catch (err) {
        log.error({ job: name, err }, 'Scheduled job failed');
      }
    };

    const task = cron.schedule(cronExpression, wrappedHandler, {
      scheduled: true,
      timezone: 'America/New_York',
    });

    this.jobs.push({ name, schedule: cronExpression, task, marketHoursOnly });
    log.info({ name, schedule: cronExpression, marketHoursOnly }, 'Job registered');
  }

  start(): void {
    // Jobs auto-start on register via scheduled: true
    log.info({ jobCount: this.jobs.length }, 'Scheduler running');
  }

  stop(): void {
    for (const job of this.jobs) {
      job.task.stop();
    }
    log.info({ jobCount: this.jobs.length }, 'All scheduled jobs stopped');
    this.jobs = [];
  }

  getScheduledJobs(): Array<{ name: string; schedule: string; marketHoursOnly: boolean }> {
    return this.jobs.map((j) => ({
      name: j.name,
      schedule: j.schedule,
      marketHoursOnly: j.marketHoursOnly,
    }));
  }
}

/** Convert a minute interval to a weekday cron expression: "* /N * * * 1-5" */
export function minutesToWeekdayCron(minutes: number): string {
  return `*/${minutes} * * * 1-5`;
}

/** Convert an ET time string like "16:30" to a cron expression on weekdays. */
export function timeToCron(time: string, daysOfWeek = '1-5'): string {
  const [hours, mins] = time.split(':').map(Number);
  return `${mins} ${hours} * * ${daysOfWeek}`;
}
