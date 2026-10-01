import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  return NextResponse.json(user || { error: "Not authenticated" }, {
    status: user ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
}
