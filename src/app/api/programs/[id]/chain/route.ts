import { NextRequest, NextResponse } from "next/server";
import { getProgramChainState } from "@/lib/db/chain";

/** On-chain state for the program page; public like the rest of program details. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    return NextResponse.json({ chain: await getProgramChainState(id) });
  } catch (error) {
    console.error("Error fetching chain state:", error);
    return NextResponse.json({ error: "Failed to fetch on-chain state" }, { status: 500 });
  }
}
