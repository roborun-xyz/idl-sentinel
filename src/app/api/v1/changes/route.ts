import { NextRequest } from "next/server";
import { apiError, apiJson, apiOptions, parseChangeQuery, queryChanges } from "@/lib/api/v1";

/** Changes across every registered program; filter with since, cursor, min_severity, category. */
export async function GET(request: NextRequest) {
  try {
    const query = parseChangeQuery(request.nextUrl.searchParams);
    if (typeof query === "string") return apiError(400, query);
    return apiJson(await queryChanges(query), { maxAge: 30 });
  } catch (error) {
    console.error("v1 changes failed:", error);
    return apiError(500, "Failed to load changes");
  }
}

export const OPTIONS = apiOptions;
