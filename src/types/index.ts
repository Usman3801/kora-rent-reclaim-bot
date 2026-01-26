/**
 * Kora Rent Reclaim Bot - Type Definitions
 * 
 * These types define the core data structures used throughout the bot
 * for tracking accounts, transactions, and reclaim operations.
 */

import { PublicKey } from '@solana/web3.js';

// =============================================================================
// Account Types
// =============================================================================

/**
 * Status of a sponsored account
 */
export enum AccountStatus {
  /** Account is active and has lamports */
  ACTIVE = 'active',
  /** Account exists but has zero balance */
  EMPTY = 'empty',
  /** Account has been closed (no longer exists on-chain) */
  CLOSED = 'closed',
  /** Rent has been successfully reclaimed */
  RECLAIMED = 'reclaimed',
  /** Account is whitelisted and should not be reclaimed */
  PROTECTED = 'protected',
  /** Error occurred while checking account */
  ERROR = 'error',
}

/**
 * Type of account being tracked
 */
export enum AccountType {
  /** System program account */
  SYSTEM = 'system',
  /** SPL Token account */
  TOKEN = 'token',
  /** Token-2022 account */
  TOKEN_2022 = 'token_2022',
  /** Associated Token Account */
  ATA = 'ata',
  /** Program-derived address */
  PDA = 'pda',
  /** Unknown account type */
  UNKNOWN = 'unknown',
}

/**
 * Represents a sponsored account tracked by the bot
 */
export interface SponsoredAccount {
  /** Account public key */
  pubkey: string;
  /** Account type */
  type: AccountType;
  /** Current status */
  status: AccountStatus;
  /** Lamports currently in the account (0 if closed) */
  lamports: number;
  /** Rent-exempt minimum for this account size */
  rentExemptMinimum: number;
  /** Owner program of the account */
  owner: string;
  /** Transaction signature that created this account */
  creationTxSignature: string;
  /** Slot when the account was created */
  creationSlot: number;
  /** Timestamp when the account was created */
  createdAt: Date;
  /** Timestamp when the account was last checked */
  lastCheckedAt: Date;
  /** Timestamp when the account was closed (if applicable) */
  closedAt?: Date;
  /** Timestamp when rent was reclaimed (if applicable) */
  reclaimedAt?: Date;
  /** Transaction signature for the reclaim operation */
  reclaimTxSignature?: string;
  /** Amount of lamports reclaimed */
  reclaimedAmount?: number;
  /** Any error message associated with this account */
  errorMessage?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Transaction Types
// =============================================================================

/**
 * A Kora-sponsored transaction
 */
export interface KoraSponsoredTransaction {
  /** Transaction signature */
  signature: string;
  /** Block slot */
  slot: number;
  /** Block time (Unix timestamp) */
  blockTime: number;
  /** Fee payer (Kora operator) */
  feePayer: string;
  /** Accounts created in this transaction */
  createdAccounts: string[];
  /** Accounts closed in this transaction */
  closedAccounts: string[];
  /** Transaction fee paid */
  fee: number;
  /** Whether the transaction succeeded */
  success: boolean;
}

// =============================================================================
// Reclaim Types
// =============================================================================

/**
 * Result of a rent reclaim operation
 */
export interface ReclaimResult {
  /** Whether the reclaim was successful */
  success: boolean;
  /** Account that was reclaimed */
  account: string;
  /** Amount of lamports reclaimed */
  amount: number;
  /** Transaction signature (if executed) */
  signature?: string;
  /** Error message (if failed) */
  error?: string;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Timestamp of the operation */
  timestamp: Date;
}

/**
 * Summary of a reclaim batch operation
 */
export interface ReclaimBatchSummary {
  /** Total accounts processed */
  totalProcessed: number;
  /** Successfully reclaimed accounts */
  successCount: number;
  /** Failed reclaim attempts */
  failedCount: number;
  /** Skipped accounts (protected, already reclaimed, etc.) */
  skippedCount: number;
  /** Total lamports reclaimed */
  totalReclaimed: number;
  /** Total lamports that could be reclaimed */
  totalReclaimable: number;
  /** Individual results */
  results: ReclaimResult[];
  /** Start time */
  startedAt: Date;
  /** End time */
  completedAt: Date;
  /** Duration in milliseconds */
  durationMs: number;
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Bot configuration
 */
export interface BotConfig {
  /** Solana RPC URL */
  rpcUrl: string;
  /** Network cluster */
  cluster: 'devnet' | 'mainnet-beta' | 'testnet';
  /** Kora fee payer public key */
  koraFeePayer: PublicKey;
  /** Operator keypair path */
  operatorKeypairPath?: string;
  /** Operator private key (base58) */
  operatorPrivateKey?: string;
  /** Treasury public key for reclaimed funds */
  treasuryPubkey?: PublicKey;
  /** Minimum account age before reclaim (days) */
  minAccountAgeDays: number;
  /** Minimum lamports to reclaim */
  minReclaimLamports: number;
  /** Maximum batch size */
  maxBatchSize: number;
  /** Dry run mode */
  dryRun: boolean;
  /** Allowed program IDs */
  allowedPrograms: PublicKey[];
  /** Blocked program IDs */
  blockedPrograms: PublicKey[];
  /** Telegram configuration */
  telegram?: {
    botToken: string;
    chatId: string;
    enabled: boolean;
  };
  /** Monitoring cron expression */
  monitorCron: string;
  /** Auto reclaim enabled */
  autoReclaim: boolean;
  /** Reclaim cron expression */
  reclaimCron: string;
  /** Database path */
  databasePath: string;
  /** Log level */
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  /** Log file path */
  logFilePath?: string;
  /** RPC rate limit */
  rpcRateLimit: number;
  /** Transaction delay (ms) */
  txDelayMs: number;
  /** Alert threshold (SOL) */
  alertThresholdSol: number;
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Statistics for reporting
 */
export interface BotStatistics {
  /** Total accounts tracked */
  totalAccounts: number;
  /** Active accounts */
  activeAccounts: number;
  /** Closed accounts (awaiting reclaim) */
  closedAccounts: number;
  /** Reclaimed accounts */
  reclaimedAccounts: number;
  /** Protected accounts */
  protectedAccounts: number;
  /** Error accounts */
  errorAccounts: number;
  /** Total lamports locked (active accounts) */
  totalLockedLamports: number;
  /** Total lamports reclaimable (closed accounts) */
  totalReclaimableLamports: number;
  /** Total lamports reclaimed historically */
  totalReclaimedLamports: number;
  /** Last scan timestamp */
  lastScanAt?: Date;
  /** Last reclaim timestamp */
  lastReclaimAt?: Date;
}

/**
 * Account age breakdown for reporting
 */
export interface AccountAgeBreakdown {
  /** Accounts less than 1 day old */
  lessThan1Day: number;
  /** Accounts 1-7 days old */
  oneToSevenDays: number;
  /** Accounts 7-30 days old */
  sevenToThirtyDays: number;
  /** Accounts more than 30 days old */
  moreThan30Days: number;
}

// =============================================================================
// Event Types (for logging and alerts)
// =============================================================================

/**
 * Bot event types
 */
export enum BotEventType {
  SCAN_STARTED = 'scan_started',
  SCAN_COMPLETED = 'scan_completed',
  ACCOUNT_DISCOVERED = 'account_discovered',
  ACCOUNT_CLOSED_DETECTED = 'account_closed_detected',
  RECLAIM_STARTED = 'reclaim_started',
  RECLAIM_SUCCESS = 'reclaim_success',
  RECLAIM_FAILED = 'reclaim_failed',
  RECLAIM_COMPLETED = 'reclaim_completed',
  ALERT_THRESHOLD_EXCEEDED = 'alert_threshold_exceeded',
  ERROR = 'error',
}

/**
 * Bot event for logging
 */
export interface BotEvent {
  type: BotEventType;
  timestamp: Date;
  message: string;
  data?: Record<string, unknown>;
}
