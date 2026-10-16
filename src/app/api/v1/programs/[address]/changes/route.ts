import { NextRequest } from "next/server";
import {
  apiError,
  apiJson,
  apiOptions,
  findProgram,
  parseChangeQuery,
  queryChanges,
} from "@/lib/api/v1";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const program = await findProgram((await params).address);
    if (!program) return apiError(404, "Program is not registered with this IDL Sentinel instance");
    const query = parseChangeQuery(request.nextUrl.searchParams);
    if (typeof query === "string") return apiError(400, query);
    return apiJson(await queryChanges({ ...query, programDbId: program.id }));
  } catch (error) {
    console.error("v1 program changes failed:", error);
    return apiError(500, "Failed to load changes");
  }
}

export const OPTIONS = apiOptions;
