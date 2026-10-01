import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "../supabase";

export async function issueNonce(walletAddress: string): Promise<string> {
  const nonce = randomBytes(32).toString("hex");
  const { error } = await supabaseAdmin.from("auth_nonces").upsert(
    {
      wallet_address: walletAddress,
      nonce,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    },
    { onConflict: "wallet_address" }
  );
  if (error) throw new Error("Failed to issue login challenge");
  return nonce;
}

export async function consumeNonce(walletAddress: string, nonce: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("consume_auth_nonce", {
    p_wallet: walletAddress,
    p_nonce: nonce,
  });
  if (error) throw new Error("Failed to consume login challenge");
  return data === true;
}

export async function cleanupNonces(): Promise<void> {
  const { error } = await supabaseAdmin
    .from("auth_nonces")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) throw new Error("Failed to clean up login challenges");
}
