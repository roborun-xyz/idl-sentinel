import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SignJWT } from "jose";
import { consumeNonce } from "@/lib/auth/nonces";
import { getJwtSecret } from "@/lib/auth/secret";
import { createSignInMessage } from "@/lib/auth/message";
import { supabaseAdmin } from "@/lib/supabase";
import nacl from "tweetnacl";

export async function POST(request: NextRequest) {
  try {
    const secret = getJwtSecret();
    const body = await request.json();
    const { walletAddress, signature, message } = body;

    if (
      typeof walletAddress !== "string" ||
      typeof signature !== "string" ||
      typeof message !== "string"
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const nonce = /Nonce: ([a-f0-9]{64})$/.exec(message)?.[1];
    if (!nonce || message !== createSignInMessage(nonce)) {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }

    // Verify the signature
    try {
      const publicKey = new PublicKey(walletAddress);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);

      const verified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());

      if (!verified) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } catch (error) {
      console.error("Error verifying signature:", error);
      return NextResponse.json({ error: "Failed to verify signature" }, { status: 401 });
    }

    if (!(await consumeNonce(walletAddress, nonce))) {
      return NextResponse.json(
        { error: "Invalid, expired, or already used nonce" },
        { status: 400 }
      );
    }

    // Create or update user in database
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, is_admin")
      .eq("wallet_address", walletAddress)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") throw new Error("Unable to load user");

    let userId: string;
    let isAdmin: boolean = false;

    if (fetchError || !existingUser) {
      // Create new user
      const { data: newUser, error: createError } = await supabaseAdmin
        .from("users")
        .insert({ wallet_address: walletAddress, is_admin: false })
        .select("id, is_admin")
        .single();

      if (createError || !newUser) {
        console.error("Error creating user:", createError);
        return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
      }

      userId = newUser.id;
      isAdmin = newUser.is_admin || false;
    } else {
      userId = existingUser.id;
      isAdmin = existingUser.is_admin || false;

      // Update last login
      await supabaseAdmin
        .from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", userId);
    }

    // Create JWT token with admin status
    const token = await new SignJWT({ walletAddress, userId, isAdmin })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(secret);

    // Set cookie
    const response = NextResponse.json({ walletAddress });
    response.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Error verifying signature:", error);
    return NextResponse.json({ error: "Failed to verify signature" }, { status: 500 });
  }
}
