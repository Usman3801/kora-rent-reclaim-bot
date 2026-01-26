/**
 * Kora Rent Reclaim Bot - Utilities
 * 
 * Common utility functions including rate limiting, retries, and helpers.
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as bs58 from 'bs58';

// =============================================================================
// Rate Limiter
// =============================================================================

/**
 * Simple token bucket rate limiter
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per second

  constructor(requestsPerSecond: number) {
    this.maxTokens = requestsPerSecond;
    this.tokens = requestsPerSecond;
    this.refillRate = requestsPerSecond;
    this.lastRefill = Date.now();
  }

  /**
   * Wait until a token is available, then consume it
   */
  async acquire(): Promise<void> {
    this.refill();
    
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Calculate wait time
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate * 1000);
    await sleep(waitTime);
    
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// =============================================================================
// Retry Logic
// =============================================================================

/**
 * Options for retry operations
 */
export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    '429',
    '503',
    '502',
    '504',
    'rate limit',
    'timeout',
  ],
};

/**
 * Executes a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.initialDelayMs;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError.message.toLowerCase();
      
      // Check if error is retryable
      const isRetryable = opts.retryableErrors?.some(e => 
        errorMessage.includes(e.toLowerCase())
      );

      if (!isRetryable || attempt === opts.maxAttempts) {
        throw lastError;
      }

      // Wait with exponential backoff
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

// =============================================================================
// Keypair Loading
// =============================================================================

/**
 * Loads a keypair from a file path or base58 string
 */
export function loadKeypair(pathOrKey: string): Keypair {
  // Check if it's a file path
  if (fs.existsSync(pathOrKey)) {
    const data = fs.readFileSync(pathOrKey, 'utf-8');
    
    // Try parsing as JSON array
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return Keypair.fromSecretKey(Uint8Array.from(parsed));
      }
    } catch {
      // Not JSON, try as base58
    }

    // Try as base58 string
    const trimmed = data.trim();
    try {
      const decoded = bs58.decode(trimmed);
      return Keypair.fromSecretKey(decoded);
    } catch {
      throw new Error(`Invalid keypair format in file: ${pathOrKey}`);
    }
  }

  // Treat as base58 string directly
  try {
    const decoded = bs58.decode(pathOrKey);
    return Keypair.fromSecretKey(decoded);
  } catch {
    throw new Error('Invalid keypair: not a valid file path or base58 string');
  }
}

// =============================================================================
// Time Utilities
// =============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get current Unix timestamp in seconds
 */
export function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Calculate age of a timestamp in days
 */
export function ageInDays(timestamp: Date | number): number {
  const ts = typeof timestamp === 'number' ? timestamp * 1000 : timestamp.getTime();
  return (Date.now() - ts) / (1000 * 60 * 60 * 24);
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: Date | number): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : timestamp;
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validates that a string is a valid Solana public key
 */
export function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates that a string is a valid transaction signature
 */
export function isValidSignature(value: string): boolean {
  try {
    const decoded = bs58.decode(value);
    return decoded.length === 64;
  } catch {
    return false;
  }
}

// =============================================================================
// Array Utilities
// =============================================================================

/**
 * Chunks an array into smaller arrays of specified size
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Filters out duplicates from an array
 */
export function unique<T>(array: T[], keyFn?: (item: T) => string): T[] {
  if (keyFn) {
    const seen = new Set<string>();
    return array.filter(item => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return [...new Set(array)];
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Truncates a string in the middle
 */
export function truncateMiddle(str: string, maxLen: number = 20): string {
  if (str.length <= maxLen) return str;
  const halfLen = Math.floor((maxLen - 3) / 2);
  return `${str.substring(0, halfLen)}...${str.substring(str.length - halfLen)}`;
}

/**
 * Formats lamports as SOL with specified decimal places
 */
export function lamportsToSol(lamports: number, decimals: number = 4): number {
  return Math.round((lamports / 1_000_000_000) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Converts SOL to lamports
 */
export function solToLamports(sol: number): number {
  return Math.floor(sol * 1_000_000_000);
}

// =============================================================================
// Security Utilities
// =============================================================================

/**
 * Masks a string for safe logging (shows first/last few chars)
 */
export function maskString(str: string, showChars: number = 4): string {
  if (str.length <= showChars * 2) return '****';
  return `${str.substring(0, showChars)}...${str.substring(str.length - showChars)}`;
}

/**
 * Generates a random request ID for tracing
 */
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}
