---
created_at: 2025-11-08
updated_at: 2026-10-01
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

Note: The CLI is primarily used for syncing schema changes, not initial setup.

## Database Schema Overview

The database consists of the following tables:

### Core Tables

- **users**: Authenticated users with wallet addresses
  - Stores wallet addresses, admin status, and notification preferences
  - Each user can configure Slack and Telegram notifications

- **monitored_programs**: Solana programs being monitored
  - Only admins can create/update/delete programs
  - Regular users can watch programs via the watchlist

- **idl_snapshots**: Historical IDL versions
  - Stores complete IDL JSON for each snapshot
  - Uses SHA-256 hash for change detection

- **idl_changes**: Detected changes between versions
  - Categorized by severity (low, medium, high, critical)
  - Tracks notification status for different channels

### Supporting Tables

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
2. Use Supabase CLI to sync changes:

   ```bash
   # Link to your project (first time only)
   npx supabase link --project-ref your-project-ref

   # Pull current remote schema to see what changed
   npx supabase db pull

   # Review the generated migration, then push it
   npx supabase db push
   ```

### Migrations Directory

The `migrations/` directory is **not used** in this project. All schema changes should be made by updating `schema.sql` and using the Supabase CLI to sync.

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

1. RLS is enabled on the table
2. Appropriate policies exist
3. You're using the correct Supabase client (with service role key for admin operations)

### Issue: Missing tables

Ensure you've run the complete `schema.sql` file in order, without errors.

## Backups

Supabase automatically backs up your database daily. You can also:

1. Export your database from the Supabase dashboard
2. Use `pg_dump` with your database credentials
3. Use the Supabase CLI: `supabase db dump`

## Support

For issues specific to:

- **Supabase**: Check [Supabase docs](https://supabase.com/docs)
- **IDL Sentinel**: Create an issue on GitHub
