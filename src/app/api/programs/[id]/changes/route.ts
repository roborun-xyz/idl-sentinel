import { NextRequest, NextResponse } from "next/server";
import { getProgramChanges } from "@/lib/db/changes";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "20");

    // Validate limit
    if (limit < 1 || limit > 100) {
      return NextResponse.json({ error: "Limit must be between 1 and 100" }, { status: 400 });
    }

    const changes = await getProgramChanges(id, limit);

    return NextResponse.json({ changes });
  } catch (error) {
    console.error("Error fetching program changes:", error);
    return NextResponse.json({ error: "Failed to fetch program changes" }, { status: 500 });
  }
}
