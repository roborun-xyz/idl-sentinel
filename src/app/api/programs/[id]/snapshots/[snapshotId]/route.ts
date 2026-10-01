import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSnapshotById } from "@/lib/db/snapshots";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; snapshotId: string }> }
) {
  const { id, snapshotId } = await params;
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.string().uuid().safeParse(snapshotId).success
  ) {
    return NextResponse.json({ error: "Invalid snapshot or program ID" }, { status: 400 });
  }
  try {
    const snapshot = await getSnapshotById(snapshotId, id);
    return NextResponse.json(snapshot ? { snapshot } : { error: "Snapshot not found" }, {
      status: snapshot ? 200 : 404,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load snapshot" }, { status: 500 });
  }
}
