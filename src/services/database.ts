/**
 * Kora Rent Reclaim Bot - Database Service (sql.js version)
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { 
  SponsoredAccount, 
  AccountStatus, 
  AccountType, 
  BotStatistics,
  AccountAgeBreakdown 
} from '../types';
import { logInfo } from '../utils/logger';

export class DatabaseService {
  private db: SqlJsDatabase | null = null;
  private readonly dbPath: string;
  private initialized: boolean = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logInfo(`Initializing database at ${this.dbPath}`);

    const SQL = await initSqlJs();
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.createTables();
    this.initialized = true;
    logInfo('Database initialized successfully');
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sponsored_accounts (
        pubkey TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'unknown',
        status TEXT NOT NULL DEFAULT 'active',
        lamports INTEGER NOT NULL DEFAULT 0,
        rent_exempt_minimum INTEGER NOT NULL DEFAULT 0,
        owner TEXT NOT NULL,
        creation_tx_signature TEXT NOT NULL,
        creation_slot INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_checked_at TEXT NOT NULL,
        closed_at TEXT,
        reclaimed_at TEXT,
        reclaim_tx_signature TEXT,
        reclaimed_amount INTEGER,
        error_message TEXT,
        metadata TEXT
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_status ON sponsored_accounts(status)`);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS reclaim_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_pubkey TEXT NOT NULL,
        tx_signature TEXT,
        amount INTEGER NOT NULL,
        success INTEGER NOT NULL,
        dry_run INTEGER NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS scan_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        accounts_scanned INTEGER NOT NULL,
        new_accounts INTEGER NOT NULL,
        closed_accounts INTEGER NOT NULL,
        errors INTEGER NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS bot_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.save();
  }

  save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }

  upsertAccount(account: SponsoredAccount): void {
    if (!this.db) throw new Error('Database not initialized');
    const existing = this.getAccount(account.pubkey);
    
    if (existing) {
      this.db.run(`
        UPDATE sponsored_accounts SET
          status = ?, lamports = ?, last_checked_at = ?,
          closed_at = COALESCE(?, closed_at),
          reclaimed_at = COALESCE(?, reclaimed_at),
          reclaim_tx_signature = COALESCE(?, reclaim_tx_signature),
          reclaimed_amount = COALESCE(?, reclaimed_amount),
          error_message = ?
        WHERE pubkey = ?
      `, [
        account.status, account.lamports, account.lastCheckedAt.toISOString(),
        account.closedAt?.toISOString() || null,
        account.reclaimedAt?.toISOString() || null,
        account.reclaimTxSignature || null,
        account.reclaimedAmount || null,
        account.errorMessage || null,
        account.pubkey
      ]);
    } else {
      this.db.run(`
        INSERT INTO sponsored_accounts (
          pubkey, type, status, lamports, rent_exempt_minimum, owner,
          creation_tx_signature, creation_slot, created_at, last_checked_at,
          closed_at, reclaimed_at, reclaim_tx_signature, reclaimed_amount,
          error_message, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        account.pubkey, account.type, account.status, account.lamports,
        account.rentExemptMinimum, account.owner, account.creationTxSignature,
        account.creationSlot, account.createdAt.toISOString(),
        account.lastCheckedAt.toISOString(),
        account.closedAt?.toISOString() || null,
        account.reclaimedAt?.toISOString() || null,
        account.reclaimTxSignature || null,
        account.reclaimedAmount || null,
        account.errorMessage || null,
        account.metadata ? JSON.stringify(account.metadata) : null
      ]);
    }
    this.save();
  }

  batchUpsertAccounts(accounts: SponsoredAccount[]): void {
    for (const account of accounts) {
      this.upsertAccount(account);
    }
  }

  getAccount(pubkey: string): SponsoredAccount | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM sponsored_accounts WHERE pubkey = ?');
    stmt.bind([pubkey]);
    if (stmt.step()) {
      const row = stmt.getAsObject() as any;
      stmt.free();
      return this.rowToAccount(row);
    }
    stmt.free();
    return null;
  }

  getAccountsByStatus(status: AccountStatus, limit?: number): SponsoredAccount[] {
    if (!this.db) throw new Error('Database not initialized');
    let sql = 'SELECT * FROM sponsored_accounts WHERE status = ?';
    if (limit) sql += ` LIMIT ${limit}`;
    const results: SponsoredAccount[] = [];
    const stmt = this.db.prepare(sql);
    stmt.bind([status]);
    while (stmt.step()) {
      results.push(this.rowToAccount(stmt.getAsObject() as any));
    }
    stmt.free();
    return results;
  }

  getReclaimableAccounts(minAgeDays: number, limit: number): SponsoredAccount[] {
    if (!this.db) throw new Error('Database not initialized');
    const cutoffDate = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000);
    const results: SponsoredAccount[] = [];
    const stmt = this.db.prepare(`
      SELECT * FROM sponsored_accounts 
      WHERE status = 'closed' AND closed_at < ? AND reclaimed_at IS NULL
      ORDER BY closed_at ASC LIMIT ?
    `);
    stmt.bind([cutoffDate.toISOString(), limit]);
    while (stmt.step()) {
      results.push(this.rowToAccount(stmt.getAsObject() as any));
    }
    stmt.free();
    return results;
  }

  updateAccountStatus(pubkey: string, status: AccountStatus, additionalFields?: Partial<SponsoredAccount>): void {
    if (!this.db) throw new Error('Database not initialized');
    const updates = ['status = ?', 'last_checked_at = ?'];
    const values: any[] = [status, new Date().toISOString()];

    if (additionalFields?.lamports !== undefined) { updates.push('lamports = ?'); values.push(additionalFields.lamports); }
    if (additionalFields?.closedAt) { updates.push('closed_at = ?'); values.push(additionalFields.closedAt.toISOString()); }
    if (additionalFields?.reclaimedAt) { updates.push('reclaimed_at = ?'); values.push(additionalFields.reclaimedAt.toISOString()); }
    if (additionalFields?.reclaimTxSignature) { updates.push('reclaim_tx_signature = ?'); values.push(additionalFields.reclaimTxSignature); }
    if (additionalFields?.reclaimedAmount !== undefined) { updates.push('reclaimed_amount = ?'); values.push(additionalFields.reclaimedAmount); }
    if (additionalFields?.errorMessage !== undefined) { updates.push('error_message = ?'); values.push(additionalFields.errorMessage); }

    values.push(pubkey);
    this.db.run(`UPDATE sponsored_accounts SET ${updates.join(', ')} WHERE pubkey = ?`, values);
    this.save();
  }

  markAsReclaimed(pubkey: string, txSignature: string | null, amount: number): void {
    this.updateAccountStatus(pubkey, AccountStatus.RECLAIMED, {
      reclaimedAt: new Date(),
      reclaimTxSignature: txSignature || undefined,
      reclaimedAmount: amount,
    });
    this.recordReclaimAttempt(pubkey, txSignature, amount, true, false);
  }

  recordReclaimAttempt(accountPubkey: string, txSignature: string | null, amount: number, success: boolean, dryRun: boolean, errorMessage?: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`INSERT INTO reclaim_history (account_pubkey, tx_signature, amount, success, dry_run, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [accountPubkey, txSignature, amount, success ? 1 : 0, dryRun ? 1 : 0, errorMessage || null, new Date().toISOString()]);
    this.save();
  }

  getStatistics(): BotStatistics {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN status = 'reclaimed' THEN 1 ELSE 0 END) as reclaimed,
        SUM(CASE WHEN status = 'protected' THEN 1 ELSE 0 END) as protected,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
        SUM(CASE WHEN status = 'active' THEN lamports ELSE 0 END) as locked_lamports,
        SUM(CASE WHEN status = 'closed' THEN rent_exempt_minimum ELSE 0 END) as reclaimable_lamports,
        SUM(CASE WHEN status = 'reclaimed' THEN reclaimed_amount ELSE 0 END) as reclaimed_lamports
      FROM sponsored_accounts
    `);
    stmt.step();
    const stats = stmt.getAsObject() as any;
    stmt.free();
    return {
      totalAccounts: stats.total || 0,
      activeAccounts: stats.active || 0,
      closedAccounts: stats.closed || 0,
      reclaimedAccounts: stats.reclaimed || 0,
      protectedAccounts: stats.protected || 0,
      errorAccounts: stats.error || 0,
      totalLockedLamports: stats.locked_lamports || 0,
      totalReclaimableLamports: stats.reclaimable_lamports || 0,
      totalReclaimedLamports: stats.reclaimed_lamports || 0,
      lastScanAt: undefined,
      lastReclaimAt: undefined,
    };
  }

  getAccountAgeBreakdown(): AccountAgeBreakdown {
    return { lessThan1Day: 0, oneToSevenDays: 0, sevenToThirtyDays: 0, moreThan30Days: 0 };
  }

  recordScan(startedAt: Date, completedAt: Date, accountsScanned: number, newAccounts: number, closedAccounts: number, errors: number): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`INSERT INTO scan_history (started_at, completed_at, accounts_scanned, new_accounts, closed_accounts, errors) VALUES (?, ?, ?, ?, ?, ?)`,
      [startedAt.toISOString(), completedAt.toISOString(), accountsScanned, newAccounts, closedAccounts, errors]);
    this.save();
  }

  getState(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT value FROM bot_state WHERE key = ?');
    stmt.bind([key]);
    if (stmt.step()) { const row = stmt.getAsObject() as any; stmt.free(); return row.value; }
    stmt.free();
    return null;
  }

  setState(key: string, value: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(`INSERT OR REPLACE INTO bot_state (key, value, updated_at) VALUES (?, ?, ?)`, [key, value, new Date().toISOString()]);
    this.save();
  }

  getLastProcessedSignature(): string | null { return this.getState('last_processed_signature'); }
  setLastProcessedSignature(signature: string): void { this.setState('last_processed_signature', signature); }

  private rowToAccount(row: any): SponsoredAccount {
    return {
      pubkey: row.pubkey,
      type: row.type as AccountType,
      status: row.status as AccountStatus,
      lamports: row.lamports,
      rentExemptMinimum: row.rent_exempt_minimum,
      owner: row.owner,
      creationTxSignature: row.creation_tx_signature,
      creationSlot: row.creation_slot,
      createdAt: new Date(row.created_at),
      lastCheckedAt: new Date(row.last_checked_at),
      closedAt: row.closed_at ? new Date(row.closed_at) : undefined,
      reclaimedAt: row.reclaimed_at ? new Date(row.reclaimed_at) : undefined,
      reclaimTxSignature: row.reclaim_tx_signature || undefined,
      reclaimedAmount: row.reclaimed_amount || undefined,
      errorMessage: row.error_message || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
