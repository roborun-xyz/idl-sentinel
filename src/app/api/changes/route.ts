import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRecentChanges, getChangeStatistics, type ChangeSeverity } from "@/lib/db/changes";

const cursorSchema = z.object({
  time: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Number(params.get("limit") || 50);
  const severity = params.get("severity") || undefined;
  const programId = params.get("programId")?.trim() || undefined;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (severity && !["low", "medium", "high", "critical"].includes(severity))
  ) {
    return NextResponse.json({ error: "Invalid limit or severity" }, { status: 400 });
  }
  let before: { time: string; id: string } | undefined;
  if (params.has("cursor")) {
    try {
      before = cursorSchema.parse(
        JSON.parse(Buffer.from(params.get("cursor")!, "base64url").toString())
      );
    } catch {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }
  }
  try {
    if (params.get("stats") === "true")
      return NextResponse.json({ statistics: await getChangeStatistics(programId) });
    const rows = await getRecentChanges(limit + 1, {
      programId,
      severity: severity as ChangeSeverity | undefined,
      search: (params.get("search") || "").slice(0, 200),
      programName: params.get("programName") || undefined,
      before,
    });
    const changes = rows.slice(0, limit);
    const last = changes[changes.length - 1];
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ time: last.detected_at, id: last.id })).toString("base64url")
        : null;
    return NextResponse.json({ changes, nextCursor });
  } catch (error) {
    console.error("Failed to load changes:", error);
    return NextResponse.json({ error: "Failed to load changes" }, { status: 500 });
  }
}
