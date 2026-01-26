# Building a Rent Reclaim Bot for Kora: A Deep Dive

## Introduction

When Kora nodes sponsor transactions on Solana, they pay rent to create accounts for users. This rent—typically 0.002 SOL per token account—adds up quickly. For a dApp with 10,000 users, that's 20 SOL locked away. This article explains how I built an automated solution to track and reclaim this rent.

## Understanding the Problem

### How Kora Works

Kora is Solana's signing infrastructure for gasless transactions. Here's the flow:

1. User creates a transaction (e.g., mint NFT)
2. Transaction is sent to Kora node
3. **Kora signs as fee payer** - paying SOL for network fees AND rent
4. User pays Kora in SPL tokens (or app subsidizes entirely)
5. Transaction executes, accounts are created

The critical insight: **Kora pays rent from the operator's wallet**, not the user's.

### The Rent Problem

Every Solana account requires a rent-exempt minimum:
- Basic account: ~0.00089 SOL
- Token account: ~0.00204 SOL
- NFT metadata: ~0.01 SOL

When users close their accounts (sell all tokens, etc.), this rent becomes reclaimable—but it doesn't automatically return to Kora.

## Solution Architecture

### Core Components
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Solana Service │────▶│ Monitor Service │────▶│ Reclaim Service │
│  (RPC calls)    │     │ (Discovery)     │     │ (Recovery)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         └───────────────────────┴───────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │   Database    │
                         │   (SQLite)    │
                         └───────────────┘
```

### Account Discovery

The bot scans all transactions from the Kora fee payer address:
```typescript
const signatures = await connection.getSignaturesForAddress(koraFeePayer);
for (const sig of signatures) {
  const tx = await connection.getParsedTransaction(sig);
  const createdAccounts = extractCreatedAccounts(tx);
  // Track in database
}
```

### Closed Account Detection

For each tracked account, we periodically check if it still exists:
```typescript
const accountInfo = await connection.getAccountInfo(pubkey);
if (!accountInfo) {
  // Account is closed - mark as reclaimable
}
```

### Safe Rent Reclaim

Before reclaiming, multiple safety checks are performed:

1. **Age verification**: Account must be closed for X days
2. **Authority check**: Operator must have close authority
3. **Balance check**: Token accounts must be empty
4. **Revival prevention**: Re-verify state before transaction

## Security Considerations

### Revival Attack Prevention

An attacker could:
1. Close an account
2. Our bot detects it
3. Attacker re-opens account before we reclaim
4. Our reclaim fails or causes issues

Solution: Always re-verify account state immediately before reclaim transaction.

### Authority Verification

We can only reclaim from accounts where the operator has close authority. This is checked before any reclaim attempt.

## Usage
```bash
# Monitor accounts (read-only)
npm run monitor

# Generate report
npm run report

# Dry-run reclaim (simulate)
npm run dry-run

# Execute reclaim
npm run reclaim
```

## Results

For a Kora operator with 10,000 sponsored accounts where 30% have closed:
- Potential recovery: ~6 SOL
- At $150/SOL = $900 recovered

## Conclusion

This bot transforms a hidden operational cost into recoverable capital. By automating the monitoring and reclaim process, Kora operators can focus on their core business while the bot handles rent recovery.

## Resources

- [Kora Documentation](https://launch.solana.com/docs/kora)
- [Solana Rent Mechanics](https://solana.com/docs/core/accounts)
- [Source Code](https://github.com/your-repo/kora-rent-reclaim-bot)
