/**
 * Kora Rent Reclaim Bot - Telegram Service (Stub)
 */

import { BotConfig, BotStatistics, ReclaimBatchSummary } from '../types';
import { logInfo } from '../utils/logger';

export class TelegramService {
  private enabled: boolean = false;

  constructor(config: BotConfig) {
    this.enabled = false;
    logInfo('Telegram notifications disabled (not configured)');
  }

  async sendMessage(message: string): Promise<void> {}
  async sendMonitoringSummary(stats: BotStatistics): Promise<void> {}
  async sendReclaimSummary(summary: ReclaimBatchSummary, dryRun: boolean): Promise<void> {}
  async sendThresholdAlert(reclaimableSol: number, threshold: number): Promise<void> {}
  async sendErrorAlert(operation: string, error: string): Promise<void> {}
}
