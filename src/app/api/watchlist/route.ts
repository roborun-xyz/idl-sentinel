import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/middleware";
import { supabaseAdmin } from "@/lib/supabase";

// Get user's watchlist
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("user_watchlist")
      .select(
        `
        id,
        program_id,
        created_at,
        monitored_programs!inner(
          id,
          program_id,
          name,
          description,
          is_active
        )
      `
      )
      .eq("user_id", user.userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching watchlist:", error);
      return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
    }

    return NextResponse.json({ watchlist: data || [] });
  } catch (error) {
    console.error("Error fetching watchlist:", error);
    return NextResponse.json({ error: "Failed to fetch watchlist" }, { status: 500 });
  }
}

// Add program to watchlist
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { programId } = body;

    if (!programId) {
      return NextResponse.json({ error: "programId is required" }, { status: 400 });
    }

    // Check if program exists
    const { data: program, error: programError } = await supabaseAdmin
      .from("monitored_programs")
      .select("id")
      .eq("id", programId)
      .single();

    if (programError || !program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    // Add to watchlist
    const { data, error } = await supabaseAdmin
      .from("user_watchlist")
      .insert({
        user_id: user.userId,
        program_id: programId,
      })
      .select()
      .single();

    if (error) {
      // Check for duplicate
      if (error.code === "23505") {
        return NextResponse.json({ error: "Program already in watchlist" }, { status: 409 });
      }
      console.error("Error adding to watchlist:", error);
      return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
    }

    return NextResponse.json({ watchlistEntry: data }, { status: 201 });
  } catch (error) {
    console.error("Error adding to watchlist:", error);
    return NextResponse.json({ error: "Failed to add to watchlist" }, { status: 500 });
  }
}

// Remove program from watchlist
export async function DELETE(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const programId = searchParams.get("programId");

    if (!programId) {
      return NextResponse.json({ error: "programId is required" }, { status: 400 });
    }

    // Delete from watchlist
    const { error } = await supabaseAdmin
      .from("user_watchlist")
      .delete()
      .eq("user_id", user.userId)
      .eq("program_id", programId);

    if (error) {
      console.error("Error removing from watchlist:", error);
      return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
    }

    return NextResponse.json({ message: "Removed from watchlist" });
  } catch (error) {
    console.error("Error removing from watchlist:", error);
    return NextResponse.json({ error: "Failed to remove from watchlist" }, { status: 500 });
  }
}
