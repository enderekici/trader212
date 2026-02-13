import { configManager } from '../config/manager.js';
import { createLogger } from '../utils/logger.js';
import type { TradePlan, TradePlanner } from './trade-planner.js';

const log = createLogger('approval-manager');

export type ApprovalCallback = (planId: number, approved: boolean) => void;

export class ApprovalManager {
  private tradePlanner: TradePlanner;

  constructor(tradePlanner: TradePlanner) {
    this.tradePlanner = tradePlanner;
  }

  async processNewPlan(plan: TradePlan): Promise<{ shouldExecute: boolean; plan: TradePlan }> {
    const requireApproval = configManager.get<boolean>('execution.requireApproval');

    if (!requireApproval) {
      // Auto-approve
      const approved = this.tradePlanner.approvePlan(plan.id, 'auto');
      log.info({ planId: plan.id, symbol: plan.symbol }, 'Trade plan auto-approved');
      return { shouldExecute: true, plan: approved ?? plan };
    }

    // Manual approval required - return pending
    log.info({ planId: plan.id, symbol: plan.symbol }, 'Trade plan awaiting manual approval');
    return { shouldExecute: false, plan };
  }

  handleApproval(planId: number, approved: boolean, approvedBy = 'manual'): TradePlan | null {
    if (approved) {
      const plan = this.tradePlanner.approvePlan(planId, approvedBy);
      log.info({ planId, approvedBy }, 'Trade plan approved');
      return plan;
    }

    this.tradePlanner.rejectPlan(planId);
    log.info({ planId }, 'Trade plan rejected');
    return null;
  }

  checkExpiredPlans(): void {
    const autoExecute = configManager.get<boolean>('execution.approvalAutoExecute');
    const pending = this.tradePlanner.getPendingPlans();
    const now = new Date().toISOString();

    for (const plan of pending) {
      if (plan.expiresAt && plan.expiresAt < now) {
        if (autoExecute) {
          this.tradePlanner.approvePlan(plan.id, 'auto-timeout');
          log.info({ planId: plan.id, symbol: plan.symbol }, 'Trade plan auto-executed on timeout');
        } else {
          this.tradePlanner.rejectPlan(plan.id);
          log.info({ planId: plan.id, symbol: plan.symbol }, 'Trade plan expired');
        }
      }
    }
  }
}
