import { NextRequest } from "next/server";
import { apiError, apiJson, apiOptions, findProgram, serializeProgramStatus } from "@/lib/api/v1";

/** Current IDL version, deployed code, upgrade authority, multisig, and verification. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const program = await findProgram((await params).address);
    if (!program) return apiError(404, "Program is not registered with this IDL Sentinel instance");
    return apiJson(await serializeProgramStatus(program));
  } catch (error) {
    console.error("v1 program status failed:", error);
    return apiError(500, "Failed to load program status");
  }
}

export const OPTIONS = apiOptions;
