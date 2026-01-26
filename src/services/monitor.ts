/**
 * Kora Rent Reclaim Bot - Account Monitor Service
 * 
 * Monitors sponsored accounts and detects state changes.
 */

import { SolanaService } from './solana';
import { DatabaseService } from './database';
import { BotConfig, SponsoredAccount, AccountStatus, AccountType, BotEventType } from '../types';
import { logInfo, logDebug, logWarn, logError, logSection, logEvent, formatSol } from '../utils/logger';
import { chunk, ageInDays } from '../utils/helpers';

export class AccountMonitorService {
  private solana: SolanaService;
  private db: DatabaseService;
  private config: BotConfig;

  constructor(solana: SolanaService, db: DatabaseService, config: BotConfig) {
    this.solana = solana;
    this.db = db;
    this.config = config;
  }

  async runMonitoringCycle(): Promise<{
    newAccounts: number;
    closedAccounts: number;
    errorAccounts: number;
    totalScanned: number;
  }> {
    logSection('MONITORING CYCLE');
    const startedAt = new Date();
    let newAccounts = 0;
    let closedAccounts = 0;
    let errorAccounts = 0;

    try {
      logInfo('Phase 1: Scanning for new sponsored accounts...');
      newAccounts = await this.discoverNewAccounts();

      logInfo('Phase 2: Checking status of tracked accounts...');
      const statusUpdate = await this.updateAccountStatuses();
      closedAccounts = statusUpdate.closed;
      errorAccounts = statusUpdate.errors;

      const completedAt = new Date();
      const totalScanned = newAccounts + statusUpdate.checked;

      this.db.recordScan(startedAt, completedAt, totalScanned, newAccounts, closedAccounts, errorAccounts);

      logEvent({
        type: BotEventType.SCAN_COMPLETED,
        timestamp: completedAt,
        message: `Monitoring cycle completed`,
        data: { newAccounts, closedAccounts, errorAccounts, totalScanned },
      });

      this.printCycleSummary({ newAccounts, closedAccounts, errorAccounts, totalScanned });
      return { newAccounts, closedAccounts, errorAccounts, totalScanned };
    } catch (err) {
      logError('Monitoring cycle failed', err);
      throw err;
    }
  }

  async discoverNewAccounts(): Promise<number> {
    let newAccountCount = 0;
    let hasMore = true;
    let beforeSignature = this.db.getLastProcessedSignature() || undefined;

    while (hasMore) {
      const { transactions, lastSignature } = await this.solana.scanSponsoredTransactions(
        beforeSignature,
        100
      );

      if (transactions.length === 0) {
        hasMore = false;
        continue;
      }

      for (const tx of transactions) {
        const createdAccounts = this.solana.extractCreatedAccounts(tx);
        
        for (const pubkey of createdAccounts) {
          const existing = this.db.getAccount(pubkey);
          if (existing) continue;

          const blockTime = tx.blockTime || Math.floor(Date.now() / 1000);
          const slot = tx.slot;

          try {
            const state = await this.solana.checkAccountState(pubkey);
            
            const account: SponsoredAccount = {
              pubkey,
              type: state.type,
              status: state.exists ? AccountStatus.ACTIVE : AccountStatus.CLOSED,
              lamports: state.lamports,
              rentExemptMinimum: state.rentExemptMinimum,
              owner: state.owner || 'unknown',
              creationTxSignature: tx.transaction.signatures[0],
              creationSlot: slot,
              createdAt: new Date(blockTime * 1000),
              lastCheckedAt: new Date(),
              closedAt: state.exists ? undefined : new Date(),
            };

            this.db.upsertAccount(account);
            newAccountCount++;

            logEvent({
              type: BotEventType.ACCOUNT_DISCOVERED,
              timestamp: new Date(),
              message: `Discovered new account: ${pubkey.substring(0, 8)}...`,
              data: { pubkey, type: state.type, lamports: state.lamports },
            });
          } catch (err) {
            logWarn(`Failed to check new account ${pubkey}`, { error: String(err) });
          }
        }
      }

      if (lastSignature) {
        this.db.setLastProcessedSignature(lastSignature);
        beforeSignature = lastSignature;
      } else {
        hasMore = false;
      }
    }

    logInfo(`Discovered ${newAccountCount} new sponsored accounts`);
    return newAccountCount;
  }

  async updateAccountStatuses(): Promise<{ checked: number; closed: number; errors: number }> {
    const activeAccounts = this.db.getAccountsByStatus(AccountStatus.ACTIVE);
    logInfo(`Checking ${activeAccounts.length} active accounts...`);

    let checked = 0;
    let closed = 0;
    let errors = 0;

    const batches = chunk(activeAccounts.map(a => a.pubkey), 100);

    for (const batch of batches) {
      const states = await this.solana.batchCheckAccountStates(batch);

      for (const [pubkey, state] of states) {
        checked++;

        try {
          if (!state.exists) {
            this.db.updateAccountStatus(pubkey, AccountStatus.CLOSED, {
              lamports: 0,
              closedAt: new Date(),
            });
            closed++;

            logEvent({
              type: BotEventType.ACCOUNT_CLOSED_DETECTED,
              timestamp: new Date(),
              message: `Account closed: ${pubkey.substring(0, 8)}...`,
              data: { pubkey },
            });
          } else {
            this.db.updateAccountStatus(pubkey, AccountStatus.ACTIVE, {
              lamports: state.lamports,
            });
          }
        } catch (err) {
          errors++;
          this.db.updateAccountStatus(pubkey, AccountStatus.ERROR, {
            errorMessage: String(err),
          });
        }
      }
    }

    logInfo(`Status update: ${closed} closed, ${errors} errors out of ${checked} checked`);
    return { checked, closed, errors };
  }

  private printCycleSummary(results: {
    newAccounts: number;
    closedAccounts: number;
    errorAccounts: number;
    totalScanned: number;
  }): void {
    const stats = this.db.getStatistics();
    
    console.log('\n📊 Monitoring Summary');
    console.log('─'.repeat(40));
    console.log(`  New accounts discovered:    ${results.newAccounts}`);
    console.log(`  Accounts found closed:      ${results.closedAccounts}`);
    console.log(`  Errors during check:        ${results.errorAccounts}`);
    console.log(`  Total accounts tracked:     ${stats.totalAccounts}`);
    console.log(`  Active accounts:            ${stats.activeAccounts}`);
    console.log(`  Closed (awaiting reclaim):  ${stats.closedAccounts}`);
    console.log(`  Already reclaimed:          ${stats.reclaimedAccounts}`);
    console.log(`  Total locked:               ${formatSol(stats.totalLockedLamports)}`);
    console.log(`  Total reclaimable:          ${formatSol(stats.totalReclaimableLamports)}`);
    console.log(`  Total reclaimed:            ${formatSol(stats.totalReclaimedLamports)}`);
    console.log('─'.repeat(40));
  }
}
