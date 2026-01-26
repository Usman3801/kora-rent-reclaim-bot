/**
 * Kora Rent Reclaim Bot - Solana Service
 * 
 * Handles all interactions with the Solana blockchain including:
 * - Transaction scanning
 * - Account state checking
 * - Rent reclaim transactions
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ParsedTransactionWithMeta,
  AccountInfo,
  LAMPORTS_PER_SOL,
  ConfirmedSignatureInfo,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createCloseAccountInstruction,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { BotConfig, SponsoredAccount, AccountStatus, AccountType } from '../types';
import { RateLimiter, withRetry, sleep } from '../utils/helpers';
import { logInfo, logDebug, logError, logWarn, logTransaction } from '../utils/logger';

/**
 * Well-known program IDs for account type detection
 */
const KNOWN_PROGRAMS = {
  SYSTEM: SystemProgram.programId.toBase58(),
  TOKEN: TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022: TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
};

export class SolanaService {
  private connection: Connection;
  private rateLimiter: RateLimiter;
  private operatorKeypair: Keypair;
  private config: BotConfig;

  constructor(config: BotConfig, operatorKeypair: Keypair) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    this.rateLimiter = new RateLimiter(config.rpcRateLimit);
    this.operatorKeypair = operatorKeypair;
  }

  // ==========================================================================
  // Transaction Scanning
  // ==========================================================================

  /**
   * Scan transactions from the Kora fee payer to find sponsored accounts
   */
  async scanSponsoredTransactions(
    beforeSignature?: string,
    limit: number = 100
  ): Promise<{
    transactions: ParsedTransactionWithMeta[];
    lastSignature: string | null;
  }> {
    await this.rateLimiter.acquire();

    const signatures = await withRetry(async () => {
      return this.connection.getSignaturesForAddress(
        this.config.koraFeePayer,
        {
          limit,
          before: beforeSignature,
        },
        'confirmed'
      );
    });

    if (signatures.length === 0) {
      return { transactions: [], lastSignature: null };
    }

    const transactions: ParsedTransactionWithMeta[] = [];

    // Fetch transaction details in batches
    for (const sigInfo of signatures) {
      if (sigInfo.err) {
        logDebug(`Skipping failed transaction: ${sigInfo.signature}`);
        continue;
      }

      await this.rateLimiter.acquire();
      
      try {
        const tx = await withRetry(async () => {
          return this.connection.getParsedTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          });
        });

        if (tx) {
          transactions.push(tx);
        }
      } catch (err) {
        logWarn(`Failed to fetch transaction ${sigInfo.signature}`, { error: String(err) });
      }
    }

    return {
      transactions,
      lastSignature: signatures[signatures.length - 1]?.signature || null,
    };
  }

  /**
   * Extract created accounts from a parsed transaction
   */
  extractCreatedAccounts(tx: ParsedTransactionWithMeta): string[] {
    const createdAccounts: string[] = [];

    if (!tx.meta || !tx.transaction.message) {
      return createdAccounts;
    }

    // Check pre/post balances for new accounts (pre = 0, post > 0)
    const accountKeys = tx.transaction.message.accountKeys;
    const preBalances = tx.meta.preBalances;
    const postBalances = tx.meta.postBalances;

    for (let i = 0; i < accountKeys.length; i++) {
      const pubkey = accountKeys[i].pubkey.toBase58();
      
      // Account was created if it had 0 balance before and positive balance after
      if (preBalances[i] === 0 && postBalances[i] > 0) {
        // Skip the fee payer
        if (pubkey !== this.config.koraFeePayer.toBase58()) {
          createdAccounts.push(pubkey);
        }
      }
    }

    // Also check inner instructions for token account creation
    if (tx.meta.innerInstructions) {
      for (const inner of tx.meta.innerInstructions) {
        for (const ix of inner.instructions) {
          if ('parsed' in ix && ix.parsed?.type === 'initializeAccount') {
            const account = ix.parsed.info?.account;
            if (account && !createdAccounts.includes(account)) {
              createdAccounts.push(account);
            }
          }
        }
      }
    }

    return createdAccounts;
  }

  // ==========================================================================
  // Account State Checking
  // ==========================================================================

  /**
   * Check the current state of an account
   */
  async checkAccountState(pubkey: string): Promise<{
    exists: boolean;
    lamports: number;
    owner: string;
    type: AccountType;
    rentExemptMinimum: number;
  }> {
    await this.rateLimiter.acquire();

    try {
      const accountInfo = await withRetry(async () => {
        return this.connection.getAccountInfo(new PublicKey(pubkey));
      });

      if (!accountInfo) {
        return {
          exists: false,
          lamports: 0,
          owner: '',
          type: AccountType.UNKNOWN,
          rentExemptMinimum: 0,
        };
      }

      const type = this.detectAccountType(accountInfo);
      const rentExemptMinimum = await this.getRentExemptMinimum(accountInfo.data.length);

      return {
        exists: true,
        lamports: accountInfo.lamports,
        owner: accountInfo.owner.toBase58(),
        type,
        rentExemptMinimum,
      };
    } catch (err) {
      logError(`Failed to check account state: ${pubkey}`, err);
      throw err;
    }
  }

  /**
   * Batch check multiple account states
   */
  async batchCheckAccountStates(pubkeys: string[]): Promise<Map<string, {
    exists: boolean;
    lamports: number;
    owner: string;
    type: AccountType;
    rentExemptMinimum: number;
  }>> {
    const results = new Map();
    
    // Process in batches of 100 (RPC limit)
    const batchSize = 100;
    
    for (let i = 0; i < pubkeys.length; i += batchSize) {
      const batch = pubkeys.slice(i, i + batchSize);
      
      await this.rateLimiter.acquire();
      
      const accountInfos = await withRetry(async () => {
        return this.connection.getMultipleAccountsInfo(
          batch.map(pk => new PublicKey(pk))
        );
      });

      for (let j = 0; j < batch.length; j++) {
        const pubkey = batch[j];
        const info = accountInfos[j];

        if (!info) {
          results.set(pubkey, {
            exists: false,
            lamports: 0,
            owner: '',
            type: AccountType.UNKNOWN,
            rentExemptMinimum: 0,
          });
        } else {
          const type = this.detectAccountType(info);
          const rentExemptMinimum = await this.getRentExemptMinimum(info.data.length);
          
          results.set(pubkey, {
            exists: true,
            lamports: info.lamports,
            owner: info.owner.toBase58(),
            type,
            rentExemptMinimum,
          });
        }
      }
    }

    return results;
  }

  /**
   * Detect the type of account based on owner program
   */
  private detectAccountType(accountInfo: AccountInfo<Buffer>): AccountType {
    const owner = accountInfo.owner.toBase58();

    switch (owner) {
      case KNOWN_PROGRAMS.SYSTEM:
        return AccountType.SYSTEM;
      case KNOWN_PROGRAMS.TOKEN:
        return AccountType.TOKEN;
      case KNOWN_PROGRAMS.TOKEN_2022:
        return AccountType.TOKEN_2022;
      case KNOWN_PROGRAMS.ASSOCIATED_TOKEN:
        return AccountType.ATA;
      default:
        // Check if it's a PDA (data length > 0 and not a known program)
        if (accountInfo.data.length > 0) {
          return AccountType.PDA;
        }
        return AccountType.UNKNOWN;
    }
  }

  /**
   * Get the rent-exempt minimum for a given data size
   */
  async getRentExemptMinimum(dataSize: number): Promise<number> {
    await this.rateLimiter.acquire();
    
    return withRetry(async () => {
      return this.connection.getMinimumBalanceForRentExemption(dataSize);
    });
  }

  // ==========================================================================
  // Rent Reclaim Operations
  // ==========================================================================

  /**
   * Attempt to reclaim rent from a closed token account
   * 
   * SECURITY: This only works for token accounts that the operator
   * has authority to close (i.e., the operator is the owner/delegate)
   */
  async reclaimTokenAccountRent(
    tokenAccountPubkey: string,
    destinationPubkey: string,
    programId: PublicKey = TOKEN_PROGRAM_ID,
    dryRun: boolean = false
  ): Promise<{
    success: boolean;
    signature?: string;
    amount?: number;
    error?: string;
  }> {
    const tokenAccount = new PublicKey(tokenAccountPubkey);
    const destination = new PublicKey(destinationPubkey);

    try {
      // First, check the account state
      const accountState = await this.checkAccountState(tokenAccountPubkey);
      
      if (!accountState.exists) {
        return {
          success: false,
          error: 'Account does not exist (already closed)',
        };
      }

      // Verify it's a token account
      if (accountState.type !== AccountType.TOKEN && 
          accountState.type !== AccountType.TOKEN_2022 &&
          accountState.type !== AccountType.ATA) {
        return {
          success: false,
          error: `Not a token account (type: ${accountState.type})`,
        };
      }

      // Get token account info to verify authority
      let tokenAccountInfo;
      try {
        tokenAccountInfo = await getAccount(
          this.connection,
          tokenAccount,
          'confirmed',
          programId
        );
      } catch (err) {
        if (err instanceof TokenAccountNotFoundError) {
          return {
            success: false,
            error: 'Token account not found or invalid',
          };
        }
        throw err;
      }

      // SECURITY: Verify the operator has close authority
      const operatorPubkey = this.operatorKeypair.publicKey;
      const hasAuthority = 
        tokenAccountInfo.owner.equals(operatorPubkey) ||
        (tokenAccountInfo.closeAuthority && tokenAccountInfo.closeAuthority.equals(operatorPubkey));

      if (!hasAuthority) {
        return {
          success: false,
          error: 'Operator does not have close authority for this account',
        };
      }

      // SECURITY: Verify the token balance is zero (can only close empty accounts)
      if (tokenAccountInfo.amount > BigInt(0)) {
        return {
          success: false,
          error: `Token account has non-zero balance: ${tokenAccountInfo.amount}`,
        };
      }

      const amount = accountState.lamports;

      if (dryRun) {
        logTransaction('reclaim', {
          account: tokenAccountPubkey,
          amount,
          success: true,
          dryRun: true,
        });

        return {
          success: true,
          amount,
        };
      }

      // Build and send the close account transaction
      const instruction = createCloseAccountInstruction(
        tokenAccount,
        destination,
        operatorPubkey,
        [],
        programId
      );

      const transaction = new Transaction().add(instruction);
      
      await this.rateLimiter.acquire();
      
      const signature = await withRetry(async () => {
        return sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.operatorKeypair],
          {
            commitment: 'confirmed',
          }
        );
      });

      logTransaction('reclaim', {
        account: tokenAccountPubkey,
        signature,
        amount,
        success: true,
        dryRun: false,
      });

      return {
        success: true,
        signature,
        amount,
      };

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      
      logTransaction('reclaim', {
        account: tokenAccountPubkey,
        success: false,
        dryRun,
        error,
      });

      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Close a system program account (requires signature from account owner)
   * 
   * NOTE: This is generally not possible for accounts you don't own.
   * Included for completeness but will usually fail.
   */
  async closeSystemAccount(
    accountPubkey: string,
    destinationPubkey: string,
    dryRun: boolean = false
  ): Promise<{
    success: boolean;
    signature?: string;
    amount?: number;
    error?: string;
  }> {
    const account = new PublicKey(accountPubkey);
    const destination = new PublicKey(destinationPubkey);

    try {
      const accountState = await this.checkAccountState(accountPubkey);
      
      if (!accountState.exists) {
        return {
          success: false,
          error: 'Account does not exist',
        };
      }

      if (accountState.type !== AccountType.SYSTEM) {
        return {
          success: false,
          error: `Not a system account (type: ${accountState.type})`,
        };
      }

      // SECURITY: Verify ownership
      const operatorPubkey = this.operatorKeypair.publicKey;
      if (accountState.owner !== operatorPubkey.toBase58()) {
        return {
          success: false,
          error: 'Operator does not own this account',
        };
      }

      const amount = accountState.lamports;

      if (dryRun) {
        logTransaction('reclaim', {
          account: accountPubkey,
          amount,
          success: true,
          dryRun: true,
        });

        return {
          success: true,
          amount,
        };
      }

      // Transfer all lamports to close the account
      const instruction = SystemProgram.transfer({
        fromPubkey: account,
        toPubkey: destination,
        lamports: amount,
      });

      const transaction = new Transaction().add(instruction);
      
      await this.rateLimiter.acquire();
      
      const signature = await withRetry(async () => {
        return sendAndConfirmTransaction(
          this.connection,
          transaction,
          [this.operatorKeypair], // This will fail if keypair doesn't match account
          {
            commitment: 'confirmed',
          }
        );
      });

      logTransaction('reclaim', {
        account: accountPubkey,
        signature,
        amount,
        success: true,
        dryRun: false,
      });

      return {
        success: true,
        signature,
        amount,
      };

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      
      logTransaction('reclaim', {
        account: accountPubkey,
        success: false,
        dryRun,
        error,
      });

      return {
        success: false,
        error,
      };
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Get the operator's SOL balance
   */
  async getOperatorBalance(): Promise<number> {
    await this.rateLimiter.acquire();
    
    return withRetry(async () => {
      return this.connection.getBalance(this.operatorKeypair.publicKey);
    });
  }

  /**
   * Get the current slot
   */
  async getCurrentSlot(): Promise<number> {
    await this.rateLimiter.acquire();
    
    return withRetry(async () => {
      return this.connection.getSlot();
    });
  }

  /**
   * Get block time for a slot
   */
  async getBlockTime(slot: number): Promise<number | null> {
    await this.rateLimiter.acquire();
    
    return withRetry(async () => {
      return this.connection.getBlockTime(slot);
    });
  }

  /**
   * Check if a program is in the allowed list (or if no allowlist, allow all)
   */
  isProgramAllowed(programId: string): boolean {
    // If no allowlist specified, allow all programs
    if (this.config.allowedPrograms.length === 0) {
      // But still check blocklist
      return !this.config.blockedPrograms.some(p => p.toBase58() === programId);
    }

    // Check allowlist
    const isAllowed = this.config.allowedPrograms.some(p => p.toBase58() === programId);
    const isBlocked = this.config.blockedPrograms.some(p => p.toBase58() === programId);

    return isAllowed && !isBlocked;
  }
}
