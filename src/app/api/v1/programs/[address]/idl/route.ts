import { NextRequest } from "next/server";
import { apiError, apiJson, apiOptions, findProgram, getLatestIdlSnapshot } from "@/lib/api/v1";

/** The latest captured IDL, byte-for-byte as stored, with its normalized hash. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const program = await findProgram((await params).address);
    if (!program) return apiError(404, "Program is not registered with this IDL Sentinel instance");
    const snapshot = await getLatestIdlSnapshot(program.id, true);
    if (!snapshot) return apiError(404, "No IDL has been captured for this program");
    return apiJson({
      hash: snapshot.idl_hash,
      version: snapshot.version_number,
      fetched_at: snapshot.fetched_at,
      idl: snapshot.idl_content,
    });
  } catch (error) {
    console.error("v1 program IDL failed:", error);
    return apiError(500, "Failed to load IDL");
  }
}

export const OPTIONS = apiOptions;
