/**
 * Kora Rent Reclaim Bot - Logger
 */

import * as winston from 'winston';
import * as path from 'path';
import { BotConfig, BotEvent, BotEventType } from '../types';

let logger: winston.Logger;
let auditLogger: winston.Logger;

export function initializeLogger(config: BotConfig): void {
  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr}`;
    })
  );

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat),
    }),
  ];

  if (config.logFilePath) {
    transports.push(new winston.transports.File({ filename: config.logFilePath, format: logFormat, maxsize: 10 * 1024 * 1024, maxFiles: 5 }));
  }

  logger = winston.createLogger({ level: config.logLevel, transports });

  const auditLogPath = config.logFilePath ? path.join(path.dirname(config.logFilePath), 'audit.log') : './logs/audit.log';
  auditLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.File({ filename: auditLogPath, maxsize: 50 * 1024 * 1024, maxFiles: 10 })],
  });
}

export function getLogger(): winston.Logger {
  if (!logger) {
    logger = winston.createLogger({ level: 'info', transports: [new winston.transports.Console()] });
  }
  return logger;
}

export function logInfo(message: string, meta?: Record<string, unknown>): void { getLogger().info(message, meta); }
export function logWarn(message: string, meta?: Record<string, unknown>): void { getLogger().warn(message, meta); }
export function logError(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void {
  const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack, ...meta } : { error: String(error), ...meta };
  getLogger().error(message, errorMeta);
}
export function logDebug(message: string, meta?: Record<string, unknown>): void { getLogger().debug(message, meta); }

export function logEvent(event: BotEvent): void {
  const { type, message, data } = event;
  switch (type) {
    case BotEventType.ERROR:
    case BotEventType.RECLAIM_FAILED:
      logError(message, undefined, data);
      break;
    case BotEventType.ALERT_THRESHOLD_EXCEEDED:
      logWarn(message, data);
      break;
    default:
      logInfo(message, data);
  }

  if ([BotEventType.RECLAIM_STARTED, BotEventType.RECLAIM_SUCCESS, BotEventType.RECLAIM_FAILED, BotEventType.RECLAIM_COMPLETED].includes(type)) {
    auditLog('RECLAIM_OPERATION', { type, message, timestamp: event.timestamp, ...data });
  }
}

export function auditLog(action: string, details: Record<string, unknown>): void {
  if (auditLogger) {
    auditLogger.info({ action, timestamp: new Date().toISOString(), ...details });
  }
}

export function logTransaction(operation: 'reclaim' | 'check' | 'scan', details: { account?: string; signature?: string; amount?: number; success: boolean; dryRun: boolean; error?: string }): void {
  auditLog('TRANSACTION', { operation, ...details });
  if (details.success) {
    logInfo(`✅ ${operation.toUpperCase()} ${details.dryRun ? '(dry-run)' : ''}: ${details.account || 'batch'}`, { signature: details.signature, amount: details.amount });
  } else {
    logError(`❌ ${operation.toUpperCase()} failed: ${details.account || 'batch'}`, undefined, { error: details.error });
  }
}

export function logSection(title: string): void {
  const separator = '═'.repeat(60);
  logInfo(separator);
  logInfo(`  ${title}`);
  logInfo(separator);
}

export function formatSol(lamports: number): string { return (lamports / 1_000_000_000).toFixed(9) + ' SOL'; }
export function formatNumber(num: number): string { return num.toLocaleString(); }
