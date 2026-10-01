---
created_at: 2025-12-28
updated_at: 2026-10-01
---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IDL Sentinel is a Next.js application that polls Solana program IDLs (Interface Definition Languages) for changes and sends notifications to users via Telegram and Slack. Admins register programs directly; signed-in users can activate a new shared program through a one-time USDC payment. The app classifies structural changes and notifies subscribed users.

## Tech Stack

- **Framework**: Next.js 16 with App Router and React Server Components
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Blockchain**: Solana Web3.js with Anchor legacy and Solana Program Metadata IDL discovery
- **Authentication**: Wallet-based auth using Solana wallet adapters
- **Notifications**: Telegram Bot API and Slack webhooks
- **Styling**: Tailwind CSS with Radix UI components

## Common Commands

### Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start development server (http://localhost:3000)
pnpm build            # Build production bundle
pnpm start            # Run production server
pnpm lint             # Run ESLint
pnpm type-check       # Run TypeScript compiler check
pnpm test             # Run local PGlite and application regression tests
pnpm format:check     # Check formatting
```

### Database Management

```bash
# Link to Supabase project (first time only)
npx supabase link --project-ref your-project-ref

# Pull current remote schema to see changes
npx supabase db pull
```

For fresh databases, run `supabase/schema.sql` in the Supabase SQL Editor. For
existing installations, pause both schedulers, run
`supabase/upgrade_reliability.sql`, deploy the matching app release, and resume
the schedules. Editing `schema.sql` does not make `supabase db push` apply it;
that command uses CLI migration files. See `supabase/README.md` for the workflow.

### Deployment Environment

- Do not commit platform project IDs, org IDs, local deployment metadata, or account-specific deployment values.
- Payment configuration:
  - `PAYMENT_TREASURY_USDC_ACCOUNT`: Required destination USDC token account; it must already exist.
  - `PAYMENT_TREASURY_WALLET`: Optional owner wallet returned as metadata, not the transfer destination.
  - `PROGRAM_ACTIVATION_FEE_USDC`: Defaults to 5 USDC when unset.
  - `SOLANA_USDC_MINT`: Defaults to mainnet USDC when unset; match the configured RPC network.
- Redeploy or restart production after changing deployment env vars.

### Common SQL Operations

```sql
-- Set admin user (run in Supabase SQL Editor)
UPDATE users SET is_admin = true WHERE wallet_address = 'YOUR_WALLET';
```

## Architecture

### Core Monitoring Flow

1. **Cron Job** ([/api/cron/monitor-idls/route.ts](../src/app/api/cron/monitor-idls/route.ts))
   - Runs every 15 minutes with the included `vercel.json` schedule
   - Protected by `CRON_SECRET` environment variable
   - Orchestrates: monitoring → change detection → notifications
   - Uses a database lease to avoid overlapping monitoring runs
   - `/api/cron/notifications` independently drains deliveries every five minutes

2. **IDL Fetching** ([lib/solana/idl-fetcher.ts](../src/lib/solana/idl-fetcher.ts))
   - Looks for a legacy Anchor IDL first, then Solana Program Metadata `idl` entries
   - Supports metadata content stored inline, at a referenced URL, or in an external account
   - Decompresses supported formats using pako and normalizes parsed JSON
   - Includes retry logic with exponential backoff

3. **Monitoring System** ([lib/monitoring/monitor.ts](../src/lib/monitoring/monitor.ts))
   - `monitorPrograms()`: Polls active programs in oldest-poll order, with a two-minute work budget
   - `fetchInitialIdl()`: One-time fetch when program is first added
   - Atomically stores snapshots and changes through `record_idl_transition`
   - Compares normalized SHA-256 hashes against the latest snapshot; recurring content creates a new version
   - Records confirmed IDL removal as a critical change; RPC failures are logged as errors
   - Logs monitoring results to `monitoring_logs`

4. **Change Detection** ([lib/monitoring/change-detector.ts](../src/lib/monitoring/change-detector.ts))
   - Compares old vs new IDL snapshots
   - Detects changes across: instructions, types, accounts, errors
   - Assigns severity levels: low, medium, high, critical
   - See the severity rules below for instruction, account, type, and error changes

5. **Notification System**
   - **Slack** ([lib/notifications/slack.ts](../src/lib/notifications/slack.ts))
     - User-configurable webhook URLs
     - Sends formatted messages with change summaries grouped by severity
     - Notifies only users watching the specific program
   - **Telegram** ([lib/notifications/telegram-user.ts](../src/lib/notifications/telegram-user.ts))
     - Shared bot with per-user chat connections
     - Uses connection tokens for authentication flow
     - Similar watchlist-based notification logic

### Authentication & Authorization

- **Wallet-Based Auth** ([lib/auth/auth-context.tsx](../src/lib/auth/auth-context.tsx))
  - Users sign a message containing a database-backed, single-use nonce with their Solana wallet
  - Backend verifies the signature, consumes the nonce, and issues a JWT
  - JWT stored in an HTTP-only cookie; the frontend reads the session from `/api/auth/me`

- **API Middleware** ([lib/auth/middleware.ts](../src/lib/auth/middleware.ts))
  - Verifies JWT tokens on API routes
  - Looks up the matching user/wallet and current `users.is_admin` flag on each authenticated request
  - Routes enforce user ownership and admin permissions before server-side database operations

- **Row Level Security (RLS)**
  - All tables have RLS enabled
  - Application tables and RPCs allow only `service_role`; direct anonymous/authenticated Data API access is revoked
  - Wallet JWTs do not create Supabase Auth sessions or set `app.current_wallet`
  - Browser clients use Next.js APIs, including for public reads

### Program Creation & Payments

- `POST /api/programs`: Admin-only direct creation without payment. A failed initial
  IDL fetch does not undo registration, and creation does not automatically add a watchlist entry.
- `POST /api/programs/preview`: Public preview of an existing program or its discoverable IDL.
- `POST /api/payments/program-activation`: Any authenticated wallet may request an
  intent for a new program with a discoverable IDL. Pending intents expire after 10 minutes.
- The frontend constructs a USDC transfer to the intent's `treasury_token_account`
  and adds its memo/reference. A plain transfer without the payment-intent memo is insufficient.
- `POST /api/payments/program-activation/confirm`: Verifies the payer, destination,
  mint, amount, and payment memo before creating the program and subscribing the payer.
- Already registered programs can be added to a signed-in user's watchlist for free.

### Database Schema

`supabase/schema.sql` defines fresh installs; `supabase/upgrade_reliability.sql`
upgrades existing installations and is embedded in the schema. Historical scripts
are not a complete migration chain. Key tables:

- **users**: Wallet addresses, admin status, notification settings
- **monitored_programs**: Shared programs with `owner_id` and admin-controlled active status
- **idl_snapshots**: Historical IDL versions with SHA-256 hashes
- **idl_changes**: Detected changes with severity and notification status
- **user_watchlist**: User subscriptions to programs
- **telegram_connection_tokens**: Temporary tokens for Telegram bot auth
- **monitoring_logs**: System logs for debugging
- **program_activation_payments**: Payment intents, transaction signatures, and activation status
- **notification_deliveries**: Per-user, per-change, per-channel delivery receipts
- **cron_locks**: Worker leases
- **auth_nonces**: Expiring, single-use login challenges

### Frontend Structure

- **App Router** ([src/app/](../src/app/))
  - Server Components by default
  - API routes in `app/api/`
  - Pages: programs, changes, settings, program detail

- **Components** ([src/components/](../src/components/))
  - `ui/`: Shadcn-style Radix UI components
  - `programs/`: Program list, detail, create form
  - `changes/`: Change list, diff viewer
  - `dashboard/`: Stats cards
  - `watchlist/`: Watchlist management
  - `wallet/`: Wallet connection UI

- **Client-Side State**
  - React Query for data fetching and caching
  - Wallet adapter for Solana wallet connections
  - Auth context for user session

## Key Design Patterns

### Server-Side Supabase Access

`src/lib/supabase.ts` exports one database client:

```typescript
// Server-side data access; bypasses RLS
export const supabaseAdmin = createClient(url, serviceRoleKey);
```

Use `supabaseAdmin` only in server-side API routes and their database/system
helpers, including operations for regular users. Enforce authorization in the
route; the client name does not imply the caller is an app admin. Browser code
calls Next.js APIs and may import database types with `import type`, never the
runtime client or service-role key. No Supabase anon key is required.

### Watchlist-Based Notifications

Users receive notifications ONLY for programs they watch:

1. User adds program to watchlist
2. Change detected for that program
3. System queries `user_watchlist` table
4. Sends notification to users watching that program
5. Records delivery receipts per recipient, change, and channel
6. Marks the channel complete once all eligible recipients have delivery receipts;
   retries skip successful recipients and back off after failures

An active browser session is not required for delivery. A crash between sending
and storing the receipt can still cause a duplicate notification.

### IDL Change Severity

Severity is auto-calculated based on change type:

- **Critical**: Instruction removal, signer/discriminator changes, confirmed IDL removal
- **High**: Account/type removal, account structure changes, instruction argument/account layout or mutability changes
- **Medium**: Other instruction modifications, type modifications, error removal
- **Low**: Error name/message modifications and new instructions, types, accounts, or errors,
  except instructions whose names include
  `initialize`, `close`, `withdraw`, `transfer`, `mint`, or `burn` are medium

## Environment Variables

Environment configuration (see [.env.example](../.env.example) and payment settings above):

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (server-side only)
- `SOLANA_RPC_URL`: Server-side Solana RPC endpoint
- `NEXT_PUBLIC_SOLANA_RPC_URL`: Client-side Solana RPC endpoint
- `NEXT_PUBLIC_SOLANA_NETWORK`: Network (mainnet-beta/devnet/testnet)
- `JWT_SECRET`: At least 32 characters for JWT signing (generate with `openssl rand -hex 32`)
- `CRON_SECRET`: Secret for protecting cron endpoints
- `TELEGRAM_BOT_TOKEN`: Required for Telegram notifications; bot token from @BotFather
- `TELEGRAM_BOT_USERNAME`: Required for Telegram connections; bot username without @
- `NEXT_PUBLIC_APP_URL`: App URL for Telegram connection links

## Database Setup

1. Create Supabase project at [supabase.com](https://supabase.com)
2. Copy contents of [supabase/schema.sql](../supabase/schema.sql) to SQL Editor
3. Execute to create all tables, indexes, policies, and triggers
4. Sign in to app with your wallet
5. Set yourself as admin: `UPDATE users SET is_admin = true WHERE wallet_address = 'YOUR_WALLET';`

See [supabase/README.md](../supabase/README.md) for detailed instructions.

## Cron Job Configuration

`vercel.json` schedules `/api/cron/monitor-idls` every 15 minutes and
`/api/cron/notifications` every five minutes. Other deployments must schedule both
endpoints with the same `CRON_SECRET` bearer header. For local testing:

```bash
# Test the monitoring endpoint manually
curl http://localhost:3000/api/cron/monitor-idls \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

## Testing Notifications

### Slack

Users can test their Slack webhook from Settings page, which calls:

```bash
POST /api/user/settings
```

### Telegram

Users connect Telegram by:

1. Click "Connect Telegram" in Settings
2. App generates connection token
3. User clicks deep link to Telegram bot
4. Bot verifies token and saves chat_id

## Important Considerations

### RPC Rate Limiting

- Use Helius whenever a Solana mainnet RPC is needed
- Configure `SOLANA_RPC_URL` and `NEXT_PUBLIC_SOLANA_RPC_URL` through environment settings; do not commit RPC keys
- IDL fetcher includes retry logic with exponential backoff

### IDL Hash Calculation

SHA-256 is calculated from normalized IDL JSON with stable object-key ordering.
An unchanged latest hash skips a snapshot; returning to an older hash creates a
new chronological version. Do not restore a global unique constraint on
`(program_id, idl_hash)`.

### Notification Tracking

Changes have separate notification flags for each channel:

- `slack_notified` / `slack_notified_at`
- `telegram_user_notified` / `telegram_user_notified_at`

These flags are supplemented by per-channel retry timestamps and
`notification_deliveries` receipts. The notification workers use per-channel
leases and preserve successful recipients across retries.

### Admin vs Regular Users

- **Admins**: Can add programs without payment, edit/delete any program, and change active status
- **Regular users**: Can view active program lists, manage their own watchlist/settings, and activate new programs through payment
- **Program owners**: Can edit names/descriptions or delete their own registry entries; they cannot change active status
- Ownership means `monitored_programs.owner_id`, not on-chain program authority
- Deletion removes the shared program, its snapshots/changes, and all subscriptions for it
- Inactive status pauses monitoring and filters regular users' program lists; it does not make detail URLs private
- Admin status stored in `users.is_admin` boolean field
- Frontend reads current admin status through `/api/auth/me`

## File Organization

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── auth/         # Authentication endpoints
│   │   ├── cron/         # Cron job endpoints
│   │   ├── admin/        # Admin-only endpoints
│   │   ├── programs/     # Program CRUD
│   │   ├── payments/     # Program activation intents and confirmation
│   │   ├── changes/      # Change history
│   │   ├── watchlist/    # Watchlist management
│   │   ├── telegram/     # Telegram bot webhook & connection
│   │   └── user/         # User settings
│   └── [pages]/          # Page components
├── components/            # React components
│   ├── ui/               # Radix UI base components
│   └── [features]/       # Feature-specific components
└── lib/                  # Core libraries
    ├── auth/             # Authentication logic
    ├── db/               # Database operations
    ├── monitoring/       # IDL monitoring & change detection
    ├── notifications/    # Slack & Telegram notifications
    ├── solana/           # Solana/Anchor IDL fetching
    ├── telegram/         # Telegram bot utilities
    └── supabase.ts       # Supabase clients & types
```

## TypeScript Types

Core types are defined in [src/lib/supabase.ts](../src/lib/supabase.ts):

- `MonitoredProgram`
- `IdlSnapshot`
- `IdlChange`
- `User`
- `UserWatchlist`
- `MonitoringLog`
- `ProgramActivationPayment`
- `NotificationDelivery`
- `CronLock`

IDL structure types in [src/lib/solana/idl-fetcher.ts](../src/lib/solana/idl-fetcher.ts):

- `SolanaIdl`
- `IdlAccount`
