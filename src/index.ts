/**
 * Kora Rent Reclaim Bot - Main Entry Point
 */

import * as dotenv from 'dotenv';
import { program } from 'commander';

import { loadConfig, printConfig } from './config';
import { initializeLogger, logInfo, logError, logSection, formatSol } from './utils/logger';
import { loadKeypair, lamportsToSol } from './utils/helpers';
import { DatabaseService } from './services/database';
import { SolanaService } from './services/solana';
import { AccountMonitorService } from './services/monitor';
import { RentReclaimService } from './services/reclaim';
import { TelegramService } from './services/telegram';
import { BotConfig } from './types';

dotenv.config();

program
  .name('kora-rent-reclaim')
  .description('Automated rent reclaim bot for Kora node operators')
  .version('1.0.0')
  .option('-m, --mode <mode>', 'Operation mode: monitor, reclaim, report, daemon', 'monitor')
  .option('--dry-run', 'Simulate reclaim without executing transactions')
  .option('--once', 'Run once and exit')
  .parse();

const options = program.opts();

class KoraRentReclaimBot {
  private config: BotConfig;
  private db: DatabaseService;
  private solana: SolanaService;
  private monitor: AccountMonitorService;
  private reclaim: RentReclaimService;
  private telegram: TelegramService;

  constructor() {
    this.config = loadConfig();
    if (options.dryRun) this.config.dryRun = true;
    initializeLogger(this.config);
    this.printBanner();
    printConfig(this.config);

    this.db = new DatabaseService(this.config.databasePath);
    const keypair = loadKeypair(this.config.operatorKeypairPath || this.config.operatorPrivateKey || '');
    this.solana = new SolanaService(this.config, keypair);
    this.monitor = new AccountMonitorService(this.solana, this.db, this.config);
    this.reclaim = new RentReclaimService(this.solana, this.db, this.config);
    this.telegram = new TelegramService(this.config);
  }

  private printBanner(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║   🔄 KORA RENT RECLAIM BOT                                ║
║   Automated rent recovery for Kora operators              ║
║                                                           ║
║   Mode: ${options.mode.padEnd(10)}  Dry Run: ${this.config.dryRun ? 'Yes' : 'No '}              ║
║   Network: ${this.config.cluster.padEnd(15)}                          ║
╚═══════════════════════════════════════════════════════════╝
    `);
  }

  async run(): Promise<void> {
    try {
      // Initialize database first!
      await this.db.initialize();
      
      const balance = await this.solana.getOperatorBalance();
      logInfo(`Operator balance: ${formatSol(balance)}`);

      switch (options.mode) {
        case 'monitor':
          await this.runMonitor();
          break;
        case 'reclaim':
          await this.runReclaim();
          break;
        case 'report':
          await this.runReport();
          break;
        default:
          throw new Error(`Unknown mode: ${options.mode}`);
      }
    } catch (err) {
      logError('Bot execution failed', err);
      process.exit(1);
    } finally {
      this.db.close();
    }
  }

  private async runMonitor(): Promise<void> {
    logSection('MONITOR MODE');
    const results = await this.monitor.runMonitoringCycle();
    const stats = this.db.getStatistics();
    await this.telegram.sendMonitoringSummary(stats);
    const reclaimableSol = lamportsToSol(stats.totalReclaimableLamports);
    if (reclaimableSol >= this.config.alertThresholdSol) {
      await this.telegram.sendThresholdAlert(reclaimableSol, this.config.alertThresholdSol);
    }
  }

  private async runReclaim(): Promise<void> {
    logSection('RECLAIM MODE');
    const summary = await this.reclaim.runReclaimCycle(this.config.dryRun);
    await this.telegram.sendReclaimSummary(summary, this.config.dryRun);
  }

  private async runReport(): Promise<void> {
    logSection('REPORT MODE');
    const stats = this.db.getStatistics();
    const ageBreakdown = this.db.getAccountAgeBreakdown();

    console.log('\n📈 KORA RENT RECLAIM BOT - FULL REPORT\n');
    console.log('═'.repeat(60));
    console.log('\n📊 ACCOUNT STATISTICS\n');
    console.log(`  Total accounts tracked:     ${stats.totalAccounts}`);
    console.log(`  ├─ Active:                  ${stats.activeAccounts}`);
    console.log(`  ├─ Closed (reclaimable):    ${stats.closedAccounts}`);
    console.log(`  ├─ Reclaimed:               ${stats.reclaimedAccounts}`);
    console.log(`  ├─ Protected:               ${stats.protectedAccounts}`);
    console.log(`  └─ Error:                   ${stats.errorAccounts}`);
    console.log('\n💰 FINANCIAL SUMMARY\n');
    console.log(`  Total rent locked:          ${formatSol(stats.totalLockedLamports)}`);
    console.log(`  Available to reclaim:       ${formatSol(stats.totalReclaimableLamports)}`);
    console.log(`  Already reclaimed:          ${formatSol(stats.totalReclaimedLamports)}`);
    console.log('\n' + '═'.repeat(60));
  }
}

const bot = new KoraRentReclaimBot();
bot.run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
