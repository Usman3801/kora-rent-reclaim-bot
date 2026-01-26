# 🔄 Kora Rent Reclaim Bot

**Automated rent recovery solution for Kora node operators on Solana**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Solana](https://img.shields.io/badge/Solana-Devnet%20%7C%20Mainnet-purple.svg)](https://solana.com/)

---

## 📋 Table of Contents

- [Overview](#overview)
- [How Kora Works](#how-kora-works)
- [Understanding Rent on Solana](#understanding-rent-on-solana)
- [The Problem This Solves](#the-problem-this-solves)
- [Features](#features)
- [Security Considerations](#security-considerations)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Architecture](#architecture)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Overview

When Kora nodes sponsor transactions on Solana, they pay rent to create accounts for users. Over time, many of these accounts become inactive, closed, or no longer needed, but the rent remains locked. This bot automatically:

1. **Monitors** accounts created through your Kora node
2. **Detects** when accounts are closed or eligible for cleanup
3. **Reclaims** locked rent SOL back to your treasury
4. **Reports** on your rent recovery metrics

### Why This Matters

```
Example: Gaming dApp using Kora for gasless transactions

Month 1:   1,000 users × 0.002 SOL rent = 2 SOL locked
Month 6:  10,000 users × 0.002 SOL rent = 20 SOL locked
Month 12: 50,000 users × 0.002 SOL rent = 100 SOL locked

If 30% of accounts close → 30 SOL recoverable
At $150/SOL = $4,500 in capital sitting idle
```

---

## How Kora Works

### What is Kora?

[Kora](https://launch.solana.com/docs/kora) is Solana's signing infrastructure that enables **gasless transactions**. Instead of requiring users to hold SOL for transaction fees, Kora allows:

- **Users** to pay fees in any SPL token (USDC, BONK, etc.)
- **Apps** to sponsor transactions entirely for their users
- **Operators** to collect fees in their preferred tokens

### The Kora Transaction Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     KORA TRANSACTION FLOW                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. User creates transaction (e.g., mint NFT, swap tokens)  │
│     └─→ User signs with their wallet                        │
│                                                              │
│  2. Transaction sent to Kora node                           │
│     └─→ Kora validates: allowed programs, rate limits, etc. │
│                                                              │
│  3. Kora node becomes FEE PAYER                             │
│     └─→ Kora signs transaction as fee payer                 │
│     └─→ Kora pays SOL for network fees + rent               │
│                                                              │
│  4. User pays Kora (optional)                               │
│     └─→ User transfers SPL tokens to Kora as payment        │
│     └─→ OR app subsidizes (fully gasless)                   │
│                                                              │
│  5. Transaction submitted to Solana network                 │
│     └─→ Accounts created have rent paid by Kora             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Where Rent Gets Locked

When Kora sponsors a transaction that **creates accounts**, the Kora operator's SOL is used to pay rent for those accounts:

| Account Type | Typical Rent | Created When |
|-------------|--------------|--------------|
| Token Account | ~0.00204 SOL | User receives new token |
| Associated Token Account | ~0.00204 SOL | First interaction with token |
| NFT Metadata | ~0.01 SOL | NFT minted |
| PDA (varies) | 0.001-0.1 SOL | Program-specific accounts |

**The key insight**: Kora pays this rent from the **operator's wallet**, not the user's wallet. When these accounts are later closed (user sells all tokens, NFT burned, etc.), the rent becomes reclaimable—but it goes to whoever closes the account, not automatically back to Kora.

---

## Understanding Rent on Solana

### Rent-Exempt Minimum

Solana requires accounts to maintain a minimum balance to remain "rent-exempt":

```
Rent-Exempt Minimum = 19.055441478439427 × account_size_in_bytes / lamports_per_year
```

For common accounts:
- **0-byte account**: 890,880 lamports (~0.00089 SOL)
- **165-byte token account**: 2,039,280 lamports (~0.00204 SOL)
- **Large accounts**: Scales linearly with size

### Account Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CREATED   │────▶│   ACTIVE    │────▶│   CLOSED    │────▶│  RECLAIMED  │
│             │     │             │     │             │     │             │
│ Rent paid   │     │ Rent locked │     │ Rent held   │     │ Rent freed  │
│ by Kora     │     │ in account  │     │ (reclaimable)│    │ to treasury │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Why Rent Recovery Isn't Automatic

When an account is closed on Solana:
1. The lamports (rent) are transferred to a **specified destination**
2. This destination is determined by the **close instruction**
3. For token accounts, only the **owner or close authority** can close

**Problem for Kora operators**: When users close their own accounts, the rent goes to the user—not back to Kora. The only way for Kora to recover rent is if:
1. The account was created with Kora as the close authority, OR
2. The account is closed through a program Kora controls, OR
3. The account owner explicitly sends rent back

This bot focuses on **monitoring and tracking** so operators understand their rent exposure, and **reclaiming rent** from accounts where Kora does have authority.

---

## The Problem This Solves

### Silent Capital Loss

Most Kora operators don't realize how much SOL is locked in rent:

| Problem | Impact |
|---------|--------|
| No visibility into sponsored accounts | Can't track rent exposure |
| No detection of closed accounts | Miss reclaim opportunities |
| No automated recovery | Manual inspection impractical |
| No reporting | Can't quantify losses |

### What This Bot Provides

| Solution | Benefit |
|----------|---------|
| **Account Discovery** | Scans Kora transactions to find all sponsored accounts |
| **Status Monitoring** | Detects when accounts are closed |
| **Rent Reclaim** | Safely reclaims rent where authorized |
| **Reporting** | Clear metrics on locked vs. reclaimed capital |
| **Alerts** | Telegram notifications for large reclaimable amounts |

---

## Features

### Core Features

- ✅ **Automatic Account Discovery** - Scans your Kora fee payer's transaction history
- ✅ **Continuous Monitoring** - Periodic checks for closed accounts
- ✅ **Safe Rent Reclaim** - Multiple safety checks before any reclaim
- ✅ **Persistent Tracking** - SQLite database survives restarts
- ✅ **Dry Run Mode** - Test reclaim logic without executing
- ✅ **Audit Trail** - Complete log of all operations

### Safety Features

- ✅ **Account Age Verification** - Only reclaim accounts closed for X days
- ✅ **Authority Verification** - Verify operator has close authority
- ✅ **Balance Verification** - Ensure token accounts are empty
- ✅ **Revival Attack Prevention** - Re-check state before reclaim
- ✅ **Program Allowlists** - Only reclaim from approved programs
- ✅ **Rate Limiting** - Respect RPC limits

### Operational Features

- ✅ **Telegram Alerts** - Real-time notifications
- ✅ **Scheduled Execution** - Cron-based monitoring and reclaim
- ✅ **Comprehensive Reports** - Detailed statistics
- ✅ **Daemon Mode** - Long-running background service

---

## Security Considerations

### ⚠️ Critical Security Practices

This bot handles operator keypairs and executes on-chain transactions. Follow these practices:

1. **Never commit `.env` or keypair files**
   ```bash
   # Verify your .gitignore includes:
   .env
   *.json  # except package.json, tsconfig.json
   keypair.json
   ```

2. **Restrict keypair file permissions**
   ```bash
   chmod 600 /path/to/keypair.json
   ```

3. **Use dedicated operator wallet**
   - Don't use your main wallet
   - Fund only what's needed for operations
   - Consider using a multi-sig or hardware wallet for mainnet

4. **Start with dry-run mode**
   ```bash
   npm start -- --mode=reclaim --dry-run
   ```

5. **Test on devnet first**
   ```env
   SOLANA_CLUSTER=devnet
   ```

### Attack Vectors Addressed

| Attack | Mitigation |
|--------|------------|
| **Account Revival Attack** | Re-verify account state immediately before reclaim |
| **Unauthorized Close** | Verify operator has close authority |
| **Non-Empty Account Close** | Check token balance is zero |
| **Private Key Theft** | Keypair loaded from file, never logged |
| **Transaction Replay** | Each transaction has unique recent blockhash |

---

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn
- Solana CLI (for keypair management)

### Quick Start

```bash
# Clone repository
git clone https://github.com/yourusername/kora-rent-reclaim-bot.git
cd kora-rent-reclaim-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit configuration
nano .env

# Build
npm run build

# Run in monitor mode (safe, read-only)
npm run monitor
```

### Creating a Keypair

If you don't have an operator keypair:

```bash
# Generate new keypair
solana-keygen new -o keypair.json

# Get the public key
solana-keygen pubkey keypair.json

# Fund on devnet
solana airdrop 2 $(solana-keygen pubkey keypair.json) --url devnet
```

---

## Configuration

### Required Settings

```env
# Solana RPC (use private endpoint for production)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet

# Kora fee payer public key
KORA_FEE_PAYER_PUBKEY=YourKoraFeePayerPublicKey

# Operator keypair (path to JSON file)
OPERATOR_KEYPAIR_PATH=./keypair.json
```

### Safety Settings

```env
# Minimum days before account can be reclaimed
MIN_ACCOUNT_AGE_DAYS=7

# Minimum lamports to reclaim (avoid dust)
MIN_RECLAIM_LAMPORTS=890880

# Maximum accounts per batch
MAX_BATCH_SIZE=50

# Always start with dry run!
DRY_RUN=true
```

### Optional: Telegram Alerts

```env
ENABLE_TELEGRAM=true
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id
ALERT_THRESHOLD_SOL=1.0
```

### Optional: Scheduling (Daemon Mode)

```env
# Monitor every 6 hours
MONITOR_CRON=0 */6 * * *

# Auto-reclaim weekly (requires explicit opt-in)
AUTO_RECLAIM=false
RECLAIM_CRON=0 0 * * 0
```

---

## Usage

### Operation Modes

#### 1. Monitor Mode (Safe, Read-Only)

Scans for sponsored accounts and checks their status without modifying anything:

```bash
npm run monitor

# Or with options
npm start -- --mode=monitor --once
```

#### 2. Reclaim Mode

Attempts to reclaim rent from eligible closed accounts:

```bash
# Dry run first (always!)
npm run dry-run

# If dry run looks good, execute
npm run reclaim
```

#### 3. Report Mode

Generates a comprehensive report:

```bash
npm run report
```

Output:
```
📈 KORA RENT RECLAIM BOT - FULL REPORT

═══════════════════════════════════════════════════════════════

📊 ACCOUNT STATISTICS

  Total accounts tracked:     1,234
  ├─ Active:                  1,100
  ├─ Closed (reclaimable):    89
  ├─ Reclaimed:               45
  ├─ Protected:               0
  └─ Error:                   0

💰 FINANCIAL SUMMARY

  Total rent locked:          2.244600000 SOL
  Available to reclaim:       0.181092000 SOL
  Already reclaimed:          0.091836000 SOL
  Recovery rate:              3.6%

📅 ACCOUNT AGE BREAKDOWN

  Less than 1 day:            23
  1-7 days:                   156
  7-30 days:                  412
  More than 30 days:          643

═══════════════════════════════════════════════════════════════
```

#### 4. Daemon Mode

Runs continuously with scheduled monitoring and reclaim:

```bash
npm start -- --mode=daemon
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--mode=<mode>` | `monitor`, `reclaim`, `report`, or `daemon` |
| `--dry-run` | Simulate reclaim without executing |
| `--once` | Run once and exit |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      KORA RENT RECLAIM BOT                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Config    │    │   Logger    │    │  Telegram   │         │
│  │   Loader    │    │  (Winston)  │    │   Service   │         │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                   │                 │
│         └──────────────────┼───────────────────┘                 │
│                            │                                     │
│  ┌─────────────────────────┴─────────────────────────┐          │
│  │                    Main Controller                 │          │
│  │  (src/index.ts)                                   │          │
│  └─────────────────────────┬─────────────────────────┘          │
│                            │                                     │
│         ┌──────────────────┼──────────────────┐                 │
│         │                  │                  │                 │
│  ┌──────┴──────┐   ┌──────┴──────┐   ┌──────┴──────┐          │
│  │   Monitor   │   │   Reclaim   │   │   Database  │          │
│  │   Service   │   │   Service   │   │   Service   │          │
│  └──────┬──────┘   └──────┬──────┘   └──────┬──────┘          │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                     │
│                     ┌──────┴──────┐                             │
│                     │   Solana    │                             │
│                     │   Service   │                             │
│                     └──────┬──────┘                             │
│                            │                                     │
└────────────────────────────┼────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │  Solana Network │
                    │  (RPC Endpoint) │
                    └─────────────────┘
```

### Project Structure

```
kora-rent-reclaim-bot/
├── src/
│   ├── index.ts              # Main entry point & CLI
│   ├── config/
│   │   └── index.ts          # Configuration loader & validation
│   ├── services/
│   │   ├── database.ts       # SQLite persistence layer
│   │   ├── solana.ts         # Blockchain interactions
│   │   ├── monitor.ts        # Account discovery & status checking
│   │   ├── reclaim.ts        # Rent reclaim operations
│   │   └── telegram.ts       # Notification service
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   └── utils/
│       ├── helpers.ts        # Utility functions
│       └── logger.ts         # Logging configuration
├── data/                     # SQLite database (gitignored)
├── logs/                     # Log files (gitignored)
├── .env.example              # Environment template
├── .gitignore                # Security-focused gitignore
├── package.json
├── tsconfig.json
└── README.md
```

### Data Flow

```
1. DISCOVERY
   Kora Fee Payer ─┬─▶ Get Signatures ─▶ Parse Transactions ─▶ Extract Accounts
                   │
2. MONITORING      │
   Database ───────┴─▶ Get Active Accounts ─▶ Check On-Chain ─▶ Update Status
                      │
3. RECLAIM            │
   Closed Accounts ◀──┘
        │
        ▼
   Safety Checks ─▶ Authority Check ─▶ Balance Check ─▶ Execute ─▶ Record
```

---

## Deployment

### Production Checklist

- [ ] Test thoroughly on devnet
- [ ] Review all safety settings
- [ ] Set up monitoring/alerts
- [ ] Use private RPC endpoint
- [ ] Secure keypair storage
- [ ] Enable log rotation
- [ ] Set up backup strategy

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/index.js", "--mode=daemon"]
```

```bash
docker build -t kora-reclaim .
docker run -d \
  --name kora-reclaim \
  -v $(pwd)/.env:/app/.env:ro \
  -v $(pwd)/keypair.json:/app/keypair.json:ro \
  -v $(pwd)/data:/app/data \
  kora-reclaim
```

### Systemd Service

```ini
[Unit]
Description=Kora Rent Reclaim Bot
After=network.target

[Service]
Type=simple
User=kora
WorkingDirectory=/opt/kora-reclaim
ExecStart=/usr/bin/node dist/index.js --mode=daemon
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### PM2 Deployment

```bash
pm2 start dist/index.js --name kora-reclaim -- --mode=daemon
pm2 save
pm2 startup
```

---

## Testing

### Running Tests

```bash
# Unit tests
npm test

# With coverage
npm run test:coverage
```

### Manual Testing on Devnet

```bash
# 1. Create test accounts
npm run test:create-accounts

# 2. Monitor them
npm run monitor

# 3. Close test accounts (manual via CLI)
spl-token close <account>

# 4. Run reclaim dry-run
npm run dry-run

# 5. Execute reclaim
npm run reclaim
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| "Keypair not found" | Check `OPERATOR_KEYPAIR_PATH` is correct |
| "RPC rate limited" | Reduce `RPC_RATE_LIMIT` or use private RPC |
| "No accounts discovered" | Verify `KORA_FEE_PAYER_PUBKEY` is correct |
| "Authority check failed" | Operator doesn't have close authority for account |
| "Account revived" | Revival attack prevented - account was re-opened |

### Debug Logging

```env
LOG_LEVEL=debug
```

### Checking Database

```bash
sqlite3 data/kora-reclaim.db

# View accounts
SELECT status, COUNT(*) FROM sponsored_accounts GROUP BY status;

# View reclaim history
SELECT * FROM reclaim_history ORDER BY created_at DESC LIMIT 10;
```

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Resources

- [Kora Documentation](https://launch.solana.com/docs/kora)
- [Kora GitHub](https://github.com/solana-foundation/kora)
- [Solana Account Model](https://solana.com/docs/core/accounts)
- [Solana Rent Documentation](https://docs.solanalabs.com/implemented-proposals/rent)
- [SPL Token Program](https://spl.solana.com/token)

---

## Support

- **Issues**: Open a GitHub issue
- **Questions**: [Solana Stack Exchange](https://solana.stackexchange.com/) (tag: `kora`)

---

*Built for the SuperteamNG Kora Bounty Challenge*
