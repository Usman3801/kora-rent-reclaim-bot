/**
 * Kora Rent Reclaim Bot - Rent Reclaim Service
 * 
 * Handles the actual rent reclaim operations with safety checks.
 */

import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { SolanaService } from './solana';
import { DatabaseService } from './database';
import { 
  BotConfig, 
  SponsoredAccount, 
  AccountStatus, 
  AccountType, 
  ReclaimResult, 
  ReclaimBatchSummary,
  BotEventType 
} from '../types';
import { logInfo, logWarn, logError, logSection, logEvent, formatSol, auditLog } from '../utils/logger';
import { sleep, ageInDays } from '../utils/helpers';

export class RentReclaimService {
  private solana: SolanaService;
  private db: DatabaseService;
  private config: BotConfig;

  constructor(solana: SolanaService, db: DatabaseService, config: BotConfig) {
    this.solana = solana;
    this.db = db;
    this.config = config;
  }

  /**
   * Run a reclaim operation on eligible accounts
   */
  async runReclaimCycle(dryRun?: boolean): Promise<ReclaimBatchSummary> {
    const isDryRun = dryRun ?? this.config.dryRun;
    
    logSection(`RENT RECLAIM CYCLE ${isDryRun ? '(DRY RUN)' : ''}`);
    
    const startedAt = new Date();
    const results: ReclaimResult[] = [];
    
    logEvent({
      type: BotEventType.RECLAIM_STARTED,
      timestamp: startedAt,
      message: `Starting reclaim cycle (dry-run: ${isDryRun})`,
      data: { dryRun: isDryRun },
    });

    // Get eligible accounts
    const eligibleAccounts = this.db.getReclaimableAccounts(
      this.config.minAccountAgeDays,
      this.config.maxBatchSize
    );

    logInfo(`Found ${eligibleAccounts.length} eligible accounts for reclaim`);

    if (eligibleAccounts.length === 0) {
      const summary = this.createEmptySummary(startedAt);
      this.printReclaimSummary(summary);
      return summary;
    }

    // Calculate total reclaimable
    const totalReclaimable = eligibleAccounts.reduce(
      (sum, a) => sum + a.rentExemptMinimum,
      0
    );

    logInfo(`Total potentially reclaimable: ${formatSol(totalReclaimable)}`);

    // Get destination address
    const destination = this.config.treasuryPubkey?.toBase58() || 
      (await this.getOperatorPubkey());

    logInfo(`Destination address: ${destination}`);

    // Process each account
    for (const account of eligibleAccounts) {
      const result = await this.reclaimAccount(account, destination, isDryRun);
      results.push(result);

      // Delay between transactions
      if (!isDryRun && result.success) {
        await sleep(this.config.txDelayMs);
      }
    }

    const completedAt = new Date();
    const summary = this.createSummary(results, totalReclaimable, startedAt, completedAt);

    // Log completion
    logEvent({
      type: BotEventType.RECLAIM_COMPLETED,
      timestamp: completedAt,
      message: `Reclaim cycle completed: ${summary.successCount} succeeded, ${summary.failedCount} failed`,
      data: {
        totalProcessed: summary.totalProcessed,
        successCount: summary.successCount,
        failedCount: summary.failedCount,
        totalReclaimed: summary.totalReclaimed,
        dryRun: isDryRun,
      },
    });

    this.printReclaimSummary(summary);
    return summary;
  }

  /**
   * Reclaim rent from a single account
   */
  private async reclaimAccount(
    account: SponsoredAccount,
    destination: string,
    dryRun: boolean
  ): Promise<ReclaimResult> {
    const timestamp = new Date();

    // Safety check: Verify account age
    if (account.closedAt) {
      const age = ageInDays(account.closedAt);
      if (age < this.config.minAccountAgeDays) {
        return {
          success: false,
          account: account.pubkey,
          amount: 0,
          error: `Account too recent (${age.toFixed(1)} days < ${this.config.minAccountAgeDays} days)`,
          dryRun,
          timestamp,
        };
      }
    }

    // Safety check: Verify minimum reclaim amount
    if (account.rentExemptMinimum < this.config.minReclaimLamports) {
      return {
        success: false,
        account: account.pubkey,
        amount: 0,
        error: `Below minimum reclaim (${account.rentExemptMinimum} < ${this.config.minReclaimLamports})`,
        dryRun,
        timestamp,
      };
    }

    // Safety check: Verify program is allowed
    if (!this.solana.isProgramAllowed(account.owner)) {
      this.db.updateAccountStatus(account.pubkey, AccountStatus.PROTECTED);
      return {
        success: false,
        account: account.pubkey,
        amount: 0,
        error: `Program not allowed: ${account.owner}`,
        dryRun,
        timestamp,
      };
    }

    // Re-verify account is actually closed
    const currentState = await this.solana.checkAccountState(account.pubkey);
    
    if (currentState.exists) {
      // Account was reopened/revived - update status
      this.db.updateAccountStatus(account.pubkey, AccountStatus.ACTIVE, {
        lamports: currentState.lamports,
      });
      
      logWarn(`Account ${account.pubkey.substring(0, 8)}... was revived (revival attack prevented)`);
      
      return {
        success: false,
        account: account.pubkey,
        amount: 0,
        error: 'Account was revived - not closed',
        dryRun,
        timestamp,
      };
    }

    // Attempt reclaim based on account type
    let result: { success: boolean; signature?: string; amount?: number; error?: string };

    try {
      switch (account.type) {
        case AccountType.TOKEN:
          result = await this.solana.reclaimTokenAccountRent(
            account.pubkey,
            destination,
            TOKEN_PROGRAM_ID,
            dryRun
          );
          break;

        case AccountType.TOKEN_2022:
          result = await this.solana.reclaimTokenAccountRent(
            account.pubkey,
            destination,
            TOKEN_2022_PROGRAM_ID,
            dryRun
          );
          break;

        case AccountType.ATA:
          result = await this.solana.reclaimTokenAccountRent(
            account.pubkey,
            destination,
            TOKEN_PROGRAM_ID,
            dryRun
          );
          break;

        case AccountType.SYSTEM:
          result = await this.solana.closeSystemAccount(
            account.pubkey,
            destination,
            dryRun
          );
          break;

        default:
          result = {
            success: false,
            error: `Unsupported account type: ${account.type}`,
          };
      }
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Update database
    if (result.success) {
      if (!dryRun) {
        this.db.markAsReclaimed(
          account.pubkey,
          result.signature || null,
          result.amount || account.rentExemptMinimum
        );
      }

      logEvent({
        type: BotEventType.RECLAIM_SUCCESS,
        timestamp,
        message: `Reclaimed ${formatSol(result.amount || 0)} from ${account.pubkey.substring(0, 8)}...`,
        data: {
          account: account.pubkey,
          amount: result.amount,
          signature: result.signature,
          dryRun,
        },
      });
    } else {
      this.db.recordReclaimAttempt(
        account.pubkey,
        null,
        0,
        false,
        dryRun,
        result.error
      );

      logEvent({
        type: BotEventType.RECLAIM_FAILED,
        timestamp,
        message: `Failed to reclaim ${account.pubkey.substring(0, 8)}...: ${result.error}`,
        data: {
          account: account.pubkey,
          error: result.error,
          dryRun,
        },
      });
    }

    return {
      success: result.success,
      account: account.pubkey,
      amount: result.amount || 0,
      signature: result.signature,
      error: result.error,
      dryRun,
      timestamp,
    };
  }

  private async getOperatorPubkey(): Promise<string> {
    // This would need access to the keypair - simplified for now
    return this.config.koraFeePayer.toBase58();
  }

  private createEmptySummary(startedAt: Date): ReclaimBatchSummary {
    const completedAt = new Date();
    return {
      totalProcessed: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalReclaimed: 0,
      totalReclaimable: 0,
      results: [],
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  private createSummary(
    results: ReclaimResult[],
    totalReclaimable: number,
    startedAt: Date,
    completedAt: Date
  ): ReclaimBatchSummary {
    const successResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    return {
      totalProcessed: results.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      skippedCount: 0,
      totalReclaimed: successResults.reduce((sum, r) => sum + r.amount, 0),
      totalReclaimable,
      results,
      startedAt,
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  private printReclaimSummary(summary: ReclaimBatchSummary): void {
    console.log('\n💰 Reclaim Summary');
    console.log('─'.repeat(40));
    console.log(`  Accounts processed:     ${summary.totalProcessed}`);
    console.log(`  Successful reclaims:    ${summary.successCount}`);
    console.log(`  Failed reclaims:        ${summary.failedCount}`);
    console.log(`  Total reclaimed:        ${formatSol(summary.totalReclaimed)}`);
    console.log(`  Total reclaimable:      ${formatSol(summary.totalReclaimable)}`);
    console.log(`  Duration:               ${(summary.durationMs / 1000).toFixed(1)}s`);
    console.log('─'.repeat(40));
  }
}
