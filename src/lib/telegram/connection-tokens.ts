import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

// Token expiration time: 10 minutes
const TOKEN_EXPIRATION_MS = 10 * 60 * 1000;

/**
 * Generate a connection token for a user and store it in the database
 * This allows token validation across serverless instances
 */
export async function generateConnectionToken(userId: string): Promise<string> {
  // Generate a cryptographically random token
  const token = crypto.randomBytes(32).toString("hex");

  // Calculate expiration time
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRATION_MS).toISOString();

  // Store token in database
  const { error } = await supabaseAdmin.from("telegram_connection_tokens").insert({
    token,
    user_id: userId,
    expires_at: expiresAt,
    used: false,
  });

  if (error) {
    console.error("Error storing connection token:", error);
    throw new Error("Failed to generate connection token");
  }

  console.log(`Generated connection token for user ${userId}, expires at ${expiresAt}`);

  return token;
}

/**
 * Verify and consume a connection token from the database
 * Returns userId if valid, null if invalid/expired/already used
 */
export async function consumeConnectionToken(token: string): Promise<string | null> {
  try {
    // Fetch token from database
    const { data: tokenData, error: fetchError } = await supabaseAdmin
      .from("telegram_connection_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (fetchError || !tokenData) {
      console.error("Token not found:", token.substring(0, 8) + "...");
      return null;
    }

    // Check if token was already used
    if (tokenData.used) {
      console.warn("Token already used:", token.substring(0, 8) + "...");
      return null;
    }

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(tokenData.expires_at);
    if (now > expiresAt) {
      console.warn("Token expired:", token.substring(0, 8) + "...", "expired at", expiresAt);
      return null;
    }

    // Mark token as used
    const { error: updateError } = await supabaseAdmin
      .from("telegram_connection_tokens")
      .update({
        used: true,
        used_at: new Date().toISOString(),
      })
      .eq("token", token);

    if (updateError) {
      console.error("Error marking token as used:", updateError);
      return null;
    }

    console.log(`Token consumed successfully for user ${tokenData.user_id}`);

    return tokenData.user_id;
  } catch (error) {
    console.error("Error consuming connection token:", error);
    return null;
  }
}

/**
 * Clean up expired and used tokens (call this periodically via cron)
 */
export async function cleanupExpiredTokens(): Promise<void> {
  try {
    const now = new Date().toISOString();

    // Delete expired tokens
    const { error: expiredError, count: expiredCount } = await supabaseAdmin
      .from("telegram_connection_tokens")
      .delete()
      .lt("expires_at", now);

    if (expiredError) {
      console.error("Error cleaning up expired tokens:", expiredError);
    } else {
      console.log(`Cleaned up ${expiredCount || 0} expired connection tokens`);
    }

    // Delete used tokens older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { error: usedError, count: usedCount } = await supabaseAdmin
      .from("telegram_connection_tokens")
      .delete()
      .eq("used", true)
      .lt("used_at", oneHourAgo);

    if (usedError) {
      console.error("Error cleaning up used tokens:", usedError);
    } else {
      console.log(`Cleaned up ${usedCount || 0} used connection tokens`);
    }
  } catch (error) {
    console.error("Error in token cleanup:", error);
  }
}
