/**
 * Kora Rent Reclaim Bot - Configuration
 * 
 * Loads and validates configuration from environment variables.
 * Includes security checks to prevent common misconfigurations.
 */

import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { BotConfig } from '../types';

/**
 * Configuration validation errors
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Configuration Error: ${message}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates a Solana public key string
 */
function validatePublicKey(value: string, fieldName: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new ConfigurationError(`Invalid public key for ${fieldName}: ${value}`);
  }
}

/**
 * Parses a comma-separated list of public keys
 */
function parsePublicKeyList(value: string | undefined): PublicKey[] {
  if (!value || value.trim() === '') {
    return [];
  }
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map((s, index) => {
      try {
        return new PublicKey(s);
      } catch {
        throw new ConfigurationError(`Invalid public key at position ${index + 1} in list: ${s}`);
      }
    });
}

/**
 * Security check: Ensure .env is not committed
 */
function checkEnvSecurity(): void {
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
    if (!gitignore.includes('.env')) {
      console.warn(
        '\n⚠️  WARNING: .env is not in .gitignore!\n' +
        '   This is a security risk. Add .env to .gitignore immediately.\n'
      );
    }
  }
}

/**
 * Security check: Validate keypair file permissions
 */
function checkKeypairSecurity(keypairPath: string): void {
  if (!fs.existsSync(keypairPath)) {
    return; // Will be caught by required field validation
  }

  try {
    const stats = fs.statSync(keypairPath);
    const mode = stats.mode & 0o777;
    
    // Check if file is readable by others (not owner)
    if (mode & 0o044) {
      console.warn(
        `\n⚠️  WARNING: Keypair file ${keypairPath} has loose permissions!\n` +
        `   Current permissions: ${mode.toString(8)}\n` +
        `   Recommended: Run 'chmod 600 ${keypairPath}'\n`
      );
    }
  } catch (err) {
    // Ignore permission check errors on Windows
  }
}

/**
 * Loads configuration from environment variables
 */
export function loadConfig(): BotConfig {
  // Security checks
  checkEnvSecurity();

  // Required fields
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new ConfigurationError('SOLANA_RPC_URL is required');
  }

  const cluster = process.env.SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | 'testnet';
  if (!cluster || !['devnet', 'mainnet-beta', 'testnet'].includes(cluster)) {
    throw new ConfigurationError('SOLANA_CLUSTER must be devnet, mainnet-beta, or testnet');
  }

  const koraFeePayerStr = process.env.KORA_FEE_PAYER_PUBKEY;
  if (!koraFeePayerStr) {
    throw new ConfigurationError('KORA_FEE_PAYER_PUBKEY is required');
  }
  const koraFeePayer = validatePublicKey(koraFeePayerStr, 'KORA_FEE_PAYER_PUBKEY');

  // Operator keypair (at least one method required)
  const operatorKeypairPath = process.env.OPERATOR_KEYPAIR_PATH;
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;

  if (!operatorKeypairPath && !operatorPrivateKey) {
    throw new ConfigurationError(
      'Either OPERATOR_KEYPAIR_PATH or OPERATOR_PRIVATE_KEY is required'
    );
  }

  if (operatorKeypairPath) {
    checkKeypairSecurity(operatorKeypairPath);
    if (!fs.existsSync(operatorKeypairPath)) {
      throw new ConfigurationError(`Keypair file not found: ${operatorKeypairPath}`);
    }
  }

  // Treasury (optional, defaults to operator)
  let treasuryPubkey: PublicKey | undefined;
  if (process.env.TREASURY_PUBKEY) {
    treasuryPubkey = validatePublicKey(process.env.TREASURY_PUBKEY, 'TREASURY_PUBKEY');
  }

  // Safety configuration
  const minAccountAgeDays = parseInt(process.env.MIN_ACCOUNT_AGE_DAYS || '7', 10);
  if (isNaN(minAccountAgeDays) || minAccountAgeDays < 0) {
    throw new ConfigurationError('MIN_ACCOUNT_AGE_DAYS must be a non-negative number');
  }

  const minReclaimLamports = parseInt(process.env.MIN_RECLAIM_LAMPORTS || '890880', 10);
  if (isNaN(minReclaimLamports) || minReclaimLamports < 0) {
    throw new ConfigurationError('MIN_RECLAIM_LAMPORTS must be a non-negative number');
  }

  const maxBatchSize = parseInt(process.env.MAX_BATCH_SIZE || '50', 10);
  if (isNaN(maxBatchSize) || maxBatchSize < 1 || maxBatchSize > 1000) {
    throw new ConfigurationError('MAX_BATCH_SIZE must be between 1 and 1000');
  }

  const dryRun = process.env.DRY_RUN?.toLowerCase() === 'true';

  // Program filters
  const allowedPrograms = parsePublicKeyList(process.env.ALLOWED_PROGRAMS);
  const blockedPrograms = parsePublicKeyList(process.env.BLOCKED_PROGRAMS);

  // Telegram configuration
  let telegram: BotConfig['telegram'];
  const telegramEnabled = process.env.ENABLE_TELEGRAM?.toLowerCase() === 'true';
  
  if (telegramEnabled) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) {
      throw new ConfigurationError(
        'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required when ENABLE_TELEGRAM is true'
      );
    }
    
    telegram = { botToken, chatId, enabled: true };
  }

  // Scheduling
  const monitorCron = process.env.MONITOR_CRON || '0 */6 * * *';
  const autoReclaim = process.env.AUTO_RECLAIM?.toLowerCase() === 'true';
  const reclaimCron = process.env.RECLAIM_CRON || '0 0 * * 0';

  // Warn about auto-reclaim on mainnet
  if (autoReclaim && cluster === 'mainnet-beta') {
    console.warn(
      '\n⚠️  WARNING: AUTO_RECLAIM is enabled on mainnet!\n' +
      '   This will automatically execute reclaim transactions.\n' +
      '   Make sure you understand the implications.\n'
    );
  }

  // Database
  const databasePath = process.env.DATABASE_PATH || './data/kora-reclaim.db';
  
  // Ensure data directory exists
  const dataDir = path.dirname(databasePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Logging
  const logLevel = (process.env.LOG_LEVEL || 'info') as BotConfig['logLevel'];
  if (!['error', 'warn', 'info', 'debug'].includes(logLevel)) {
    throw new ConfigurationError('LOG_LEVEL must be error, warn, info, or debug');
  }

  const logFilePath = process.env.LOG_FILE_PATH;
  if (logFilePath) {
    const logDir = path.dirname(logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  // Rate limiting
  const rpcRateLimit = parseInt(process.env.RPC_RATE_LIMIT || '10', 10);
  if (isNaN(rpcRateLimit) || rpcRateLimit < 1) {
    throw new ConfigurationError('RPC_RATE_LIMIT must be a positive number');
  }

  const txDelayMs = parseInt(process.env.TX_DELAY_MS || '1000', 10);
  if (isNaN(txDelayMs) || txDelayMs < 0) {
    throw new ConfigurationError('TX_DELAY_MS must be a non-negative number');
  }

  const alertThresholdSol = parseFloat(process.env.ALERT_THRESHOLD_SOL || '1.0');
  if (isNaN(alertThresholdSol) || alertThresholdSol < 0) {
    throw new ConfigurationError('ALERT_THRESHOLD_SOL must be a non-negative number');
  }

  return {
    rpcUrl,
    cluster,
    koraFeePayer,
    operatorKeypairPath,
    operatorPrivateKey,
    treasuryPubkey,
    minAccountAgeDays,
    minReclaimLamports,
    maxBatchSize,
    dryRun,
    allowedPrograms,
    blockedPrograms,
    telegram,
    monitorCron,
    autoReclaim,
    reclaimCron,
    databasePath,
    logLevel,
    logFilePath,
    rpcRateLimit,
    txDelayMs,
    alertThresholdSol,
  };
}

/**
 * Prints current configuration (with sensitive data masked)
 */
export function printConfig(config: BotConfig): void {
  console.log('\n📋 Configuration:');
  console.log('─'.repeat(50));
  console.log(`  Cluster:           ${config.cluster}`);
  console.log(`  RPC URL:           ${maskUrl(config.rpcUrl)}`);
  console.log(`  Kora Fee Payer:    ${config.koraFeePayer.toBase58()}`);
  console.log(`  Treasury:          ${config.treasuryPubkey?.toBase58() || '(operator wallet)'}`);
  console.log(`  Dry Run:           ${config.dryRun}`);
  console.log(`  Min Account Age:   ${config.minAccountAgeDays} days`);
  console.log(`  Min Reclaim:       ${config.minReclaimLamports} lamports`);
  console.log(`  Max Batch Size:    ${config.maxBatchSize}`);
  console.log(`  Auto Reclaim:      ${config.autoReclaim}`);
  console.log(`  Telegram Enabled:  ${config.telegram?.enabled || false}`);
  console.log(`  Allowed Programs:  ${config.allowedPrograms.length || 'all'}`);
  console.log(`  Blocked Programs:  ${config.blockedPrograms.length}`);
  console.log('─'.repeat(50));
}

/**
 * Masks sensitive parts of a URL
 */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    // Mask API keys in path
    const pathParts = parsed.pathname.split('/');
    const maskedParts = pathParts.map(part => {
      if (part.length > 20 && /^[a-zA-Z0-9_-]+$/.test(part)) {
        return part.substring(0, 8) + '...' + part.substring(part.length - 4);
      }
      return part;
    });
    parsed.pathname = maskedParts.join('/');
    return parsed.toString();
  } catch {
    return url.substring(0, 30) + '...';
  }
}
