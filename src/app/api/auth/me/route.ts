import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";

const headers = { "Cache-Control": "no-store" };

/**
 * Returns the current wallet session. Anonymous visitors get an empty 204 so the
 * public pages do not log an unauthorized error on every load.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return new NextResponse(null, { status: 204, headers });
  return NextResponse.json(user, { status: 200, headers });
}
