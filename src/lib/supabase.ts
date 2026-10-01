import { fetchWithTimeout } from "./http";
import type { SolanaIdl } from "./solana/idl-fetcher";
import type { ChangeDetails } from "./db/changes";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Admin client for backend operations (API routes)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetchWithTimeout(input, { ...init, timeoutMs: 15_000 }) },
});

// Database types
export interface MonitoredProgram {
  id: string;
  program_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  owner_id?: string | null;
  created_at: string;
  updated_at: string;
  last_checked_at?: string | null;
}

export interface IdlSnapshot {
  id: string;
  program_id: string;
  idl_hash: string;
  idl_content: SolanaIdl;
  version_number: number;
  fetched_at: string;
}

export interface IdlChange {
  id: string;
  program_id: string;
  old_snapshot_id?: string;
  new_snapshot_id: string;
  change_type: string;
  change_summary: string;
  change_details: ChangeDetails;
  severity: "low" | "medium" | "high" | "critical";
  notified: boolean;
  notified_at?: string;
  slack_notified?: boolean;
  slack_notified_at?: string;
  telegram_user_notified?: boolean;
  telegram_user_notified_at?: string;
  detected_at: string;
}

export interface NotificationDelivery {
  id: string;
  change_id: string;
  user_id: string;
  channel: "slack" | "telegram_user";
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_error?: string | null;
  last_attempt_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonitoringLog {
  id: string;
  run_id: string;
  program_id?: string;
  log_level: "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface CronLock {
  lock_name: string;
  run_id: string;
  locked_until: string;
  acquired_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  wallet_address: string;
  is_admin: boolean;
  slack_webhook_url?: string | null;
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
  created_at: string;
  last_login_at: string;
}

export interface UserWatchlist {
  id: string;
  user_id: string;
  program_id: string;
  created_at: string;
}

export type ProgramActivationPaymentStatus =
  | "pending"
  | "confirmed"
  | "consumed"
  | "expired"
  | "failed";

export interface ProgramActivationPayment {
  id: string;
  user_id: string;
  payer_wallet: string;
  program_address: string;
  program_name: string;
  description?: string | null;
  amount_usdc: number;
  amount_atomic: number;
  usdc_mint: string;
  treasury_token_account: string;
  payment_reference: string;
  status: ProgramActivationPaymentStatus;
  payment_signature?: string | null;
  error_message?: string | null;
  created_at: string;
  expires_at: string;
  confirmed_at?: string | null;
  consumed_at?: string | null;
  updated_at: string;
}
