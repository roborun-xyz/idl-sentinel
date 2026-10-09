---
created_at: 2025-11-08
updated_at: 2026-10-08
---

# Supabase Database Setup

This directory contains the database schema for IDL Sentinel.

## Quick Setup

### Option 1: Using Supabase Dashboard (Recommended)

1. **Create a new Supabase project** at [https://supabase.com](https://supabase.com)

2. **Open the SQL Editor** in your Supabase dashboard

3. **Copy and paste** the contents of `schema.sql` into the SQL editor

4. **Click "Run"** to execute the schema

5. **Set up your admin user**:
   - First, sign in to your app with your wallet
   - Then run this in the SQL editor:
   ```sql
   UPDATE users SET is_admin = true
   WHERE wallet_address = 'YOUR_WALLET_ADDRESS';
   ```

### Option 2: Using Supabase CLI

1. **Link to your project**:

   ```bash
   npx supabase link --project-ref your-project-ref
   ```

2. **Apply the schema** (if fresh database):
   - Run the contents of `schema.sql` in the Supabase SQL Editor
   - Or use the CLI after creating an initial migration from schema.sql

Editing `schema.sql` does not make `supabase db push` apply it. That command uses
CLI migration files; the documented setup and upgrade paths use the SQL Editor.

## Database Schema Overview

The database consists of the following tables:

### Core Tables

- **users**: Authenticated users with wallet addresses
  - Stores wallet addresses, admin status, and notification preferences
  - Each user can configure Slack, Discord, and Telegram notifications

- **monitored_programs**: Solana programs being monitored
  - Admins create programs directly; signed-in users can activate a new program
    after a verified USDC payment
  - Admins and the registry owner (`owner_id`) can edit or delete a program
  - Only admins can change active status; any signed-in user can watch a program

- **idl_snapshots**: Historical IDL versions
  - Stores complete IDL JSON for each snapshot
  - Uses SHA-256 of normalized JSON for change detection against the latest version
  - Returning to earlier IDL content creates a new chronological version

- **idl_changes**: Detected changes between versions
  - Categorized by severity (low, medium, high, critical)
  - Tracks notification status for different channels

### Supporting Tables

- **program_activation_payments**: Payment intents for new shared programs
  - Stores the payer, exact fee, mint, treasury token account, reference, and status
  - Confirmed transactions are consumed when activation completes

- **notification_deliveries**: Per-user, per-change, per-channel delivery receipts
  - Preserves successful deliveries while failed recipients are retried

- **auth_nonces**: Expiring, single-use wallet login challenges

- **cron_locks**: Database leases for monitoring and notification workers

- **user_watchlist**: Programs users are subscribed to
  - Users receive notifications only for watched programs

- **telegram_connection_tokens**: Temporary auth tokens
  - Used for Telegram bot authentication flow

- **monitoring_logs**: System logs
  - Debugging and monitoring information

## Schema Management

The `schema.sql` file is the **single source of truth** for the database schema. It contains the complete, final state of all tables, indexes, policies, triggers, and functions.

### For New Deployments (Fresh Setup)

**If you're cloning the repo and setting up a new database:**

Simply run `schema.sql` in your Supabase SQL Editor - this creates the entire database schema in one go, including all optimizations.

**DO NOT** run the migration files - they are only for existing deployments.

```sql
-- In Supabase SQL Editor, copy and paste the entire contents of:
-- supabase/schema.sql
```

### For Existing Deployments (Upgrading)

Pause both schedulers, run all of [upgrade_reliability.sql](upgrade_reliability.sql)
in the Supabase SQL Editor, deploy the matching application release, then resume
the schedules. This transactional, repeatable upgrade is also included verbatim
in `schema.sql`. It preserves existing rows, permits rollback versions, and adds
atomic transition/nonce operations and bounded list/aggregate RPCs.
It also adds the Discord notification channel; changes recorded before the
upgrade are marked as already delivered for Discord so new webhooks start clean.

All application tables and RPCs are restricted to `service_role`. Wallet JWTs
are verified by Next.js and do not establish Supabase Auth sessions. Public data
is served by Next.js read APIs. Do not restore the old permissive policies.

Run `pnpm test` to validate the schema, repeated upgrades, role restrictions,
transaction recovery, nonce consumption, and query pagination locally.

### Files in This Directory

- **`schema.sql`** - Complete database schema (use for fresh setup)
- **`upgrade_reliability.sql`** - Current upgrade for existing databases
- **`migration_production_optimizations.sql`** - Historical optimization script; do not reapply after the current upgrade
- **`README.md`** - This file

### For Schema Updates

When making changes to the database:

1. Update `schema.sql` to reflect the new desired state
2. Provide a matching upgrade script for existing installations, preserving data
   and the service-role access model
3. Keep the current reliability upgrade synchronized with its embedded copy in
   `schema.sql` when changing that upgrade
4. Run `pnpm test` to check fresh setup and upgrades locally
5. Apply the reviewed SQL through the SQL Editor using the deployment sequence above

### Migrations Directory

The `migrations/` directory contains historical SQL, including
`add_preferred_explorer.sql`. It is not a complete deployment migration chain.
Use `schema.sql` for fresh setup and the documented upgrade script for existing
installations; do not apply historical scripts after the current upgrade.

## Security

### Row Level Security (RLS)

All application tables enable RLS and grant access only to the server's
`service_role`. The anonymous and authenticated Data API roles have no direct
access. Next.js endpoints expose public reads and enforce wallet ownership/admin
permissions for writes.

### Environment Configuration

Set `SUPABASE_SERVICE_ROLE_KEY` only on the server. Wallet authentication uses
signed JWT cookies and database-backed, single-use nonces; it does not rely on
`app.current_wallet` or a browser Supabase Auth session.

## Troubleshooting

### Issue: Permission denied

Check that:

1. The server has the correct `SUPABASE_SERVICE_ROLE_KEY` for this project
2. The current schema or upgrade has been applied completely
3. Browser requests go through Next.js APIs, which enforce session and ownership checks

Direct table access using an anonymous or Supabase authenticated-role client is
intentionally denied.

### Issue: Missing tables

Ensure you've run the complete `schema.sql` file in order, without errors.

## Backups

Configure backups for your deployment and verify the available restore points.
For manual exports, you can:

1. Export your database from the Supabase dashboard
2. Use `pg_dump` with your database credentials
3. Use the Supabase CLI: `supabase db dump`

## Support

For issues specific to:

- **Supabase**: Check [Supabase docs](https://supabase.com/docs)
- **IDL Sentinel**: Create an issue on GitHub
