import { NextRequest } from "next/server";
import { apiError, apiJson, apiOptions, getChangeById } from "@/lib/api/v1";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return apiError(404, "Change not found");
    const change = await getChangeById(id);
    if (!change) return apiError(404, "Change not found");
    return apiJson(change, { maxAge: 3600 });
  } catch (error) {
    console.error("v1 change failed:", error);
    return apiError(500, "Failed to load change");
  }
}

export const OPTIONS = apiOptions;
