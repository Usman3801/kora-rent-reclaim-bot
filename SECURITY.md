# Security Policy

## 🔒 Security Best Practices

This bot handles sensitive cryptographic materials (private keys) and executes on-chain transactions. Security is paramount.

### Private Key Handling

1. **Never commit private keys or keypair files**
   - The `.gitignore` is configured to exclude common keypair patterns
   - Always verify before committing: `git status`

2. **Restrict file permissions**
   ```bash
   chmod 600 keypair.json
   chmod 600 .env
   ```

3. **Use environment variables or secure vaults in production**
   - Consider HashiCorp Vault, AWS Secrets Manager, or similar
   - The bot supports loading keypairs from file paths

4. **Use dedicated wallets**
   - Never use your main wallet as the operator
   - Fund with only what's necessary

### Transaction Safety

1. **Always use dry-run first**
   ```bash
   npm start -- --mode=reclaim --dry-run
   ```

2. **Verify authority before reclaim**
   - The bot checks operator has close authority
   - Accounts without authority are marked as "protected"

3. **Account revival attack prevention**
   - State is re-verified immediately before reclaim
   - If account was re-opened, reclaim is aborted

4. **Token balance verification**
   - Only empty token accounts can be closed
   - Non-zero balances are rejected

### Minimum Age Protection

To prevent accidental reclaim of recently closed accounts that might be re-opened:

```env
MIN_ACCOUNT_AGE_DAYS=7
```

This ensures accounts must be closed for at least 7 days before being eligible.

### Program Filtering

Control which programs' accounts can be reclaimed:

```env
# Only allow specific programs (whitelist)
ALLOWED_PROGRAMS=TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

# Block specific programs (blacklist)
BLOCKED_PROGRAMS=malicious111111111111111111111111111111111111
```

## 🚨 Reporting Vulnerabilities

If you discover a security vulnerability:

1. **Do NOT open a public issue**
2. Email security concerns to the maintainers privately
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## ⚠️ Known Limitations

### What This Bot CAN Reclaim

1. **Token accounts where operator is owner or close authority**
2. **ATAs where operator is owner or close authority**
3. **System accounts owned by the operator**

### What This Bot CANNOT Reclaim

1. **User-owned accounts** - Even if Kora paid the rent, the user owns the account
2. **Program-owned PDAs** - Require program logic to close
3. **Accounts without close authority** - Standard security model

### The Rent Recovery Reality

For most Kora operators:
- The rent paid is effectively a cost of doing business
- Users own their accounts and can close them (rent goes to user)
- Only accounts where Kora retained authority can be reclaimed

This bot helps you:
1. **Track** all rent exposure
2. **Identify** accounts that CAN be reclaimed
3. **Recover** what's possible
4. **Report** for accounting purposes

## 🔐 Audit Trail

All operations are logged for audit purposes:

- `logs/audit.log` - All reclaim attempts (success and failure)
- `data/kora-reclaim.db` - Complete operation history

Keep these files secure and backed up for compliance.

## 📋 Security Checklist

Before running in production:

- [ ] `.env` file has restricted permissions (`chmod 600`)
- [ ] Keypair file has restricted permissions (`chmod 600`)
- [ ] `.gitignore` properly excludes sensitive files
- [ ] No sensitive data in git history
- [ ] Using private RPC endpoint (not public)
- [ ] Telegram alerts configured for anomaly detection
- [ ] Tested thoroughly on devnet
- [ ] Dry-run verified before live execution
- [ ] Backup strategy for database
- [ ] Log rotation configured
- [ ] Monitoring/alerting in place
