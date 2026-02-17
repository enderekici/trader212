import { createLogger } from '../utils/logger.js';
import { createBacktestEngine } from './engine.js';
import type { BacktestConfig, WalkForwardResult, WalkForwardWindow } from './types.js';

const log = createLogger('walk-forward');

export class WalkForwardAnalyzer {
  private config: BacktestConfig;
  private windows: number;
  private trainRatio: number;

  constructor(config: BacktestConfig, windows: number, trainRatio: number) {
    this.config = config;
    this.windows = windows;
    this.trainRatio = trainRatio;
  }

  async run(): Promise<WalkForwardResult> {
    const startMs = new Date(this.config.startDate).getTime();
    const endMs = new Date(this.config.endDate).getTime();
    const windowMs = (endMs - startMs) / this.windows;

    const windowResults: WalkForwardWindow[] = [];

    for (let i = 0; i < this.windows; i++) {
      const windowStart = startMs + i * windowMs;
      const windowEnd = windowStart + windowMs;
      const trainEnd = windowStart + windowMs * this.trainRatio;

      const trainConfig: BacktestConfig = {
        ...this.config,
        startDate: new Date(windowStart).toISOString().split('T')[0],
        endDate: new Date(trainEnd).toISOString().split('T')[0],
      };

      const testConfig: BacktestConfig = {
        ...this.config,
        startDate: new Date(trainEnd).toISOString().split('T')[0],
        endDate: new Date(windowEnd).toISOString().split('T')[0],
      };

      log.info(
        {
          window: i + 1,
          trainStart: trainConfig.startDate,
          trainEnd: trainConfig.endDate,
          testStart: testConfig.startDate,
          testEnd: testConfig.endDate,
        },
        'Running walk-forward window',
      );

      const trainEngine = await createBacktestEngine(trainConfig);
      const trainResult = await trainEngine.run();

      const testEngine = await createBacktestEngine(testConfig);
      const testResult = await testEngine.run();

      windowResults.push({
        windowIndex: i,
        trainStart: trainConfig.startDate,
        trainEnd: trainConfig.endDate,
        testStart: testConfig.startDate,
        testEnd: testConfig.endDate,
        trainResult,
        testResult,
      });
    }

    // Aggregate out-of-sample metrics
    const testResults = windowResults.map((w) => w.testResult);
    const avgTestReturn =
      testResults.reduce((s, r) => s + r.metrics.returnPct, 0) / testResults.length;
    const sharpes = testResults
      .map((r) => r.metrics.sharpeRatio)
      .filter((s): s is number => s != null);
    const avgTestSharpe =
      sharpes.length > 0 ? sharpes.reduce((a, b) => a + b, 0) / sharpes.length : null;
    const avgTestWinRate =
      testResults.reduce((s, r) => s + r.metrics.winRate, 0) / testResults.length;
    const avgTestMaxDrawdown =
      testResults.reduce((s, r) => s + r.metrics.maxDrawdownPct, 0) / testResults.length;
    const totalTestTrades = testResults.reduce((s, r) => s + r.metrics.totalTrades, 0);

    // OOS consistency: % of windows with positive returns
    const positiveWindows = testResults.filter((r) => r.metrics.returnPct > 0).length;
    const oosConsistency = positiveWindows / testResults.length;

    log.info(
      { windows: this.windows, avgTestReturn, avgTestSharpe, oosConsistency },
      'Walk-forward analysis complete',
    );

    return {
      config: this.config,
      windows: windowResults,
      aggregateMetrics: {
        avgTestReturn,
        avgTestSharpe,
        avgTestWinRate,
        avgTestMaxDrawdown,
        totalTestTrades,
        oosConsistency,
      },
    };
  }
}
