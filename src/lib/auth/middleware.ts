import { NextRequest } from "next/server";
import { jwtVerify } from "jose";

import { getJwtSecret } from "./secret";
import { supabaseAdmin } from "../supabase";

export interface AuthUser {
  walletAddress: string;
  userId: string;
  isAdmin: boolean;
}

export async function getAuthUser(request: NextRequest): Promise<AuthUser | null> {
  try {
    const token = request.cookies.get("auth-token")?.value;

    if (!token) {
      return null;
    }

    const { payload } = await jwtVerify(token, getJwtSecret(), { algorithms: ["HS256"] });

    if (typeof payload.walletAddress !== "string" || typeof payload.userId !== "string")
      return null;
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("is_admin")
      .eq("id", payload.userId)
      .eq("wallet_address", payload.walletAddress)
      .maybeSingle();
    if (error || !user) return null;

    return {
      walletAddress: payload.walletAddress as string,
      userId: payload.userId as string,
      isAdmin: user.is_admin === true,
    };
  } catch (error) {
    console.error("Error verifying token:", error);
    return null;
  }
}

export function requireAuth(handler: (request: NextRequest, user: AuthUser) => Promise<Response>) {
  return async (request: NextRequest) => {
    const user = await getAuthUser(request);

    if (!user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    return handler(request, user);
  };
}
