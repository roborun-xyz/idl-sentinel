import { NextRequest, NextResponse } from "next/server";
import { getProgramSnapshots } from "@/lib/db/snapshots";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || "10");

    // Validate limit
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      return NextResponse.json({ error: "Limit must be between 1 and 50" }, { status: 400 });
    }

    const snapshots = await getProgramSnapshots(id, limit);

    return NextResponse.json({ snapshots });
  } catch (error) {
    console.error("Error fetching program snapshots:", error);
    return NextResponse.json({ error: "Failed to fetch program snapshots" }, { status: 500 });
  }
}
