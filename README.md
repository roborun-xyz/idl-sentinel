---
created_at: 2025-11-02
updated_at: 2026-10-08
---

# IDL Sentinel

IDL Sentinel is a self-hostable Next.js app for watching Solana program IDLs.
It fetches on-chain IDLs on a schedule, stores versioned snapshots, classifies
structural changes, and sends alerts to users who watch the affected programs.
An IDL, or Interface Definition Language, describes a program's public interface:
the instructions clients can call, the accounts they pass, the custom types they
decode, and the errors they may receive.

Use it when you depend on Solana programs and want to know when their public API
surface changes: instructions, account layouts, custom types, errors, or the IDL
itself.

IDL Sentinel is useful for protocol teams, integrators, wallet and indexer
developers, auditors, and anyone else who wants a warning when a program's
published interface changes.

## What It Does

- Monitors Anchor legacy IDL accounts and Solana Program Metadata IDL entries.
- Stores every new IDL snapshot in Supabase.
- Compares snapshots and records low, medium, high, or critical changes.
- Alerts only users who have the changed program in their watchlist.
- Supports Slack incoming webhooks, Discord webhooks, and Telegram bot notifications.
- Lets admins add programs directly.
- Lets regular users activate a new shared program by paying a one-time USDC fee.

## How It Works

1. A program is added to `monitored_programs`.
2. IDL Sentinel fetches its current on-chain IDL and stores the first snapshot.
3. A cron job calls `/api/cron/monitor-idls`, usually every 15 minutes.
4. The monitor fetches each active program IDL and hashes the normalized JSON.
5. When the hash changes, IDL Sentinel creates a new snapshot and records the diff.
6. Slack, Discord, and Telegram notifications are sent to users watching that program.

IDL Sentinel needs a discoverable Anchor or Program Metadata IDL to capture an
initial snapshot. The paid activation flow requires one before creating a payment
intent. Admins can register a program even when the initial IDL fetch fails.

## Quick Start

### Prerequisites

- Node.js 20.9 or newer
- pnpm
- A Supabase project
- A Solana wallet for signing in
- A Helius Solana mainnet RPC URL for production monitoring

### 1. Install

```bash
git clone <repository-url>
cd idl-sentinel
pnpm install
```

### 2. Configure Environment Variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`.

Minimum required for the app to boot and authenticate:

| Variable                     | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`   | Supabase project URL                                         |
| `SUPABASE_SERVICE_ROLE_KEY`  | Server-side key for cron, monitoring, and system writes      |
| `SOLANA_RPC_URL`             | Server-side RPC used by IDL fetches and payment verification |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Browser RPC used by wallet/payment flows                     |
| `NEXT_PUBLIC_SOLANA_NETWORK` | `mainnet-beta`, `devnet`, or `testnet`                       |
| `JWT_SECRET`                 | At least 32 characters; required for signed wallet sessions  |
| `CRON_SECRET`                | Bearer token required by the monitoring endpoint             |
| `NEXT_PUBLIC_APP_URL`        | Public app URL, for example `http://localhost:3000` locally  |

Generate secrets with:

```bash
openssl rand -hex 32
```

Configuration for non-admin program activation payments:

| Variable                        | Purpose                                                      |
| ------------------------------- | ------------------------------------------------------------ |
| `PROGRAM_ACTIVATION_FEE_USDC`   | One-time activation fee; defaults to 5 USDC when unset       |
| `SOLANA_USDC_MINT`              | Token mint; defaults to mainnet USDC when unset              |
| `PAYMENT_TREASURY_WALLET`       | Optional treasury owner wallet; not the transfer destination |
| `PAYMENT_TREASURY_USDC_ACCOUNT` | Required destination USDC token account                      |

The app transfers USDC to `PAYMENT_TREASURY_USDC_ACCOUNT`. Configure an existing
token account for the selected mint and network; the app does not create the
treasury account. Store deployment-specific addresses in environment settings,
not in committed documentation. Restart or redeploy after changing these values.

Required for Telegram notifications:

| Variable                | Purpose                  |
| ----------------------- | ------------------------ |
| `TELEGRAM_BOT_TOKEN`    | Bot token from BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` |

Slack and Discord do not require global app secrets. Each user stores their own
incoming webhook URLs in Settings.

### 3. Create the Database

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Copy all of [supabase/schema.sql](supabase/schema.sql) into the editor.
4. Run the SQL.

The schema creates the tables, indexes, triggers, functions, and Row Level
Security policies used by the app.

### 4. Run Locally

```bash
pnpm dev
```

Open `http://localhost:3000`.

Connect a Solana wallet. The app will ask you to sign a message so it can create
or verify your IDL Sentinel user session.

### 5. Make Yourself an Admin

After your first wallet sign-in creates a row in `users`, run this in the
Supabase SQL Editor:

```sql
UPDATE users
SET is_admin = true
WHERE wallet_address = 'YOUR_WALLET_ADDRESS';
```

Refresh the app after updating the row. Admin users can add programs without
paying the activation fee, edit or delete any program, and change its active
status. Inactive programs are excluded from monitoring and regular users' program
lists; this status is not a privacy control for program detail URLs.

### 6. Add Your First Program

As an admin:

1. Go to Programs.
2. Click Add Program.
3. Enter a Solana program ID and name.
4. Save the program.
5. Add it to your watchlist if you want notifications; direct admin creation does
   not automatically subscribe you.

As a regular user:

1. Connect your wallet, sign in, and go to Programs.
2. Click Add Program.
3. Preview the program IDL.
4. If it is already monitored, add it to your watchlist for free.
5. If it is new, enter a name and approve the one-time USDC activation payment.
   Successful confirmation creates the shared program and adds it to your watchlist.

New programs are added to the shared registry. Once a program is in the registry,
any user can watch it for free.

### Activation Payment Flow

- `POST /api/programs` creates a program directly and requires an admin session.
- `POST /api/programs/preview` is public and checks IDL availability or whether
  the program is already registered.
- `POST /api/payments/program-activation` requires a signed-in wallet and creates
  a payment intent that expires after 10 minutes.
- The wallet submits the exact quoted USDC amount to the intent's treasury token
  account, with the payment-intent memo and reference generated by the app.
- `POST /api/payments/program-activation/confirm` verifies the transaction before
  creating the program and adding the payer's watchlist subscription.

Use the app's activation flow: a plain USDC transfer without the payment-intent
memo does not activate monitoring. The fee applies to registering a new shared
program; adding an existing program to a watchlist is free.

## Upgrading an Existing Installation

Pause the monitoring and notification schedulers, then execute the entire
[supabase/upgrade_reliability.sql](supabase/upgrade_reliability.sql) in the Supabase
SQL Editor. The script is transactional and safe to reapply. Deploy this release,
then resume both schedules. Do not run the old monitoring code after this upgrade.

The upgrade records recurring IDL content as separate chronological versions,
commits snapshots and changes atomically, adds database-backed login challenges,
and revokes direct Data API access for anonymous/authenticated roles. Browser
clients use the Next.js APIs; the service-role key remains server-side.

`pnpm test` runs local PostgreSQL (PGlite) and application regression tests.
It does not contact Supabase, Solana, Slack, Discord, or Telegram. Existing missed alerts
are not reconstructed by the upgrade.

## Monitoring Cron

The monitor endpoint is:

```text
GET /api/cron/monitor-idls
Authorization: Bearer <CRON_SECRET>
```

For local testing:

```bash
curl http://localhost:3000/api/cron/monitor-idls \
  -H "Authorization: Bearer $CRON_SECRET"
```

The repo includes [vercel.json](vercel.json), which schedules the endpoint every
15 minutes on Vercel. If you deploy somewhere else, configure a scheduler that
calls the same endpoint with the Authorization header.

`/api/cron/notifications` also runs every five minutes to drain pending deliveries
independently of monitoring. Use the same `CRON_SECRET` header. Per-channel locks,
per-user delivery receipts, and exponential retry delays preserve progress across
runs; successful recipients are skipped on retries. A crash after sending but
before saving a receipt can still cause a duplicate delivery.

Monitoring visits programs in oldest-poll order and stops starting new work after
two minutes. Remaining programs are picked up on the next scheduled run.

Each run:

- fetches active program IDLs,
- creates new snapshots when IDLs change,
- records detected changes,
- sends pending Slack, Discord, and Telegram notifications,
- cleans up expired Telegram connection tokens.

## Notifications

Notifications are watchlist-based. A user receives an alert only when:

1. the program is in their watchlist,
2. the notification channel is configured,
3. a detected change is pending delivery for that channel and recipient.

Signing in is required to manage subscriptions and settings. Users do not need
an active browser session to receive alerts. Alerts link back to the program page
when `NEXT_PUBLIC_APP_URL` is an absolute `https://` URL.

### Slack

Each user configures Slack from Settings by pasting an incoming webhook URL. The
app accepts webhook URLs beginning with `https://hooks.slack.com/` and includes a
test button.

### Discord

Each user configures Discord from Settings by pasting a channel webhook URL
(Channel settings, Integrations, Webhooks). The app accepts URLs beginning with
`https://discord.com/api/webhooks/` or `https://discordapp.com/api/webhooks/`
and includes a test button. Alerts arrive as a single embed, colored by the
highest severity, with a link to the program page.

### Telegram

1. Create a Telegram bot with BotFather.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and `NEXT_PUBLIC_APP_URL`.
3. Register the webhook:

   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$NEXT_PUBLIC_APP_URL/api/telegram/webhook"
   ```

4. In IDL Sentinel, go to Settings and click Connect Telegram.
5. Open the generated Telegram link and press Start.

Telegram connection links expire after 10 minutes.

## User Roles

### Admins

- Add programs directly without payment.
- Edit program names and descriptions.
- Change active status to pause monitoring and exclude programs from regular users' lists.
- Delete programs.
- View all programs, including inactive ones.

### Regular Users

- View active monitored programs.
- Add or remove programs from their watchlist.
- Configure Slack, Discord, and Telegram notifications.
- Add a new shared program through the USDC activation flow.
- Edit or delete programs they activated.

Program ownership is the registry row's `owner_id`, assigned to the user who
created it; it does not prove control of the Solana program. Only admins can
change active status. Deleting a shared program also deletes its snapshots,
changes, and all users' watchlist subscriptions for that program.

## Change Severity

IDL Sentinel assigns a severity to each detected change:

| Severity   | Examples                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `critical` | Instruction removed, signer/discriminator changed, IDL confirmed missing                                   |
| `high`     | Account/type removed, account structure changed, instruction argument/account layout or mutability changed |
| `medium`   | Other instruction changes, type modifications, errors removed                                              |
| `low`      | New instruction, account, type, or error added; error names/messages modified                              |

New instructions whose names include `initialize`, `close`, `withdraw`,
`transfer`, `mint`, or `burn` are classified as medium rather than low.

## Useful Commands

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm type-check
pnpm test
pnpm format:check
```

## Project Structure

```text
src/app/api/cron/monitor-idls/  Monitoring cron endpoint
src/lib/solana/idl-fetcher.ts   On-chain IDL discovery and parsing
src/lib/monitoring/             Snapshot comparison and change detection
src/lib/notifications/          Slack, Discord, and Telegram delivery
src/lib/auth/                   Wallet signature auth and JWT sessions
src/lib/db/                     Supabase data access helpers
supabase/schema.sql             Database source of truth
```

## Troubleshooting

### The app starts but shows no data

Make sure the Supabase schema has been applied and `.env.local` points at the
same Supabase project.

### Wallet sign-in fails

Check `JWT_SECRET`, browser wallet support for message signing, and the
Supabase keys. The app creates the user during wallet verification.

### A program cannot be activated

Confirm the program has a public on-chain IDL. IDL Sentinel checks Anchor legacy
IDL accounts and Solana Program Metadata IDL entries.

### The cron endpoint returns 401

The request must include:

```text
Authorization: Bearer <CRON_SECRET>
```

### No notifications are sent

Check that the program is in the user's watchlist, the user configured Slack,
Discord, or Telegram, the cron endpoint is running, and there is at least one pending change
for that watched program.

### Payment activation fails

Confirm `PAYMENT_TREASURY_USDC_ACCOUNT` is a valid USDC token account, the payer
has a USDC token account with enough balance, and both client and server RPC URLs
point to the intended Solana network.
