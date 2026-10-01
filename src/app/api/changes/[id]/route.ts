import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getChangeDetails } from "@/lib/db/changes";
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid change ID" }, { status: 400 });
  try {
    const details = await getChangeDetails(id);
    return NextResponse.json(details ? { details } : { error: "Change not found" }, {
      status: details ? 200 : 404,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load change" }, { status: 500 });
  }
}
