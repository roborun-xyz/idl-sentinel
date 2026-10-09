import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";

// Debug endpoint to check JWT contents
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    if (!user) {
      return NextResponse.json({
        authenticated: false,
        message: "No valid JWT token found",
      });
    }

    return NextResponse.json({
      authenticated: true,
      walletAddress: user.walletAddress,
      userId: user.userId,
      isAdmin: user.isAdmin,
      message: "JWT decoded successfully",
    });
  } catch (error) {
    return NextResponse.json(
      {
        authenticated: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
