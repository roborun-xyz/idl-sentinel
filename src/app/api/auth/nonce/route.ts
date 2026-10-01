import { NextRequest, NextResponse } from "next/server";
import { issueNonce } from "@/lib/auth/nonces";
import { getJwtSecret } from "@/lib/auth/secret";
import { isValidProgramId } from "@/lib/utils";

export async function POST(request: NextRequest) {
  try {
    getJwtSecret();
    const { walletAddress } = await request.json();
    if (typeof walletAddress !== "string" || !isValidProgramId(walletAddress)) {
      return NextResponse.json({ error: "Valid wallet address required" }, { status: 400 });
    }
    return NextResponse.json(
      { nonce: await issueNonce(walletAddress) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to generate nonce:", error);
    return NextResponse.json({ error: "Unable to create login challenge" }, { status: 500 });
  }
}
