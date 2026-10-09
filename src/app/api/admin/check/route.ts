import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase";

// Check admin status and list all admins
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    // Get all admin users
    const { data: admins, error } = await supabaseAdmin
      .from("users")
      .select("wallet_address, created_at, last_login_at")
      .eq("is_admin", true)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          error: "Failed to fetch admin users",
          details: error.message,
          hint: "Have you applied the database migrations?",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      currentUser: user
        ? {
            walletAddress: user.walletAddress,
            isAdmin: user.isAdmin,
            userId: user.userId,
          }
        : null,
      isAuthenticated: !!user,
      isAdmin: user?.isAdmin || false,
      allAdmins: admins || [],
      adminCount: admins?.length || 0,
    });
  } catch (error) {
    console.error("Error checking admin status:", error);
    return NextResponse.json(
      {
        error: "Failed to check admin status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
