import { NextRequest, NextResponse } from "next/server";
import { getProgramById, updateProgram, deleteProgram } from "@/lib/db/programs";
import { getAuthUser } from "@/lib/auth/middleware";
import type { MonitoredProgram } from "@/lib/supabase";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const program = await getProgramById(id);

    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ program });
  } catch (error) {
    console.error("Error fetching program:", error);
    return NextResponse.json({ error: "Failed to fetch program" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Check authentication
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;

    // Check if program exists and user owns it
    const existingProgram = await getProgramById(id);
    if (!existingProgram) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    const isProgramOwner = !!existingProgram.owner_id && existingProgram.owner_id === user.userId;

    // Only admins can update programs. Owners can update their own user-created programs.
    if (!user.isAdmin && !isProgramOwner) {
      return NextResponse.json(
        { error: "Only administrators can update programs" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, is_active } = body;

    // Validation
    const updates: Partial<Pick<MonitoredProgram, "name" | "description" | "is_active">> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.length < 2 || name.length > 100) {
        return NextResponse.json(
          { error: "Name must be between 2 and 100 characters" },
          { status: 400 }
        );
      }
      updates.name = name;
    }

    if (description !== undefined) {
      if (description !== null && (typeof description !== "string" || description.length > 500)) {
        return NextResponse.json(
          { error: "Description must be less than 500 characters" },
          { status: 400 }
        );
      }
      updates.description = description;
    }

    if (is_active !== undefined) {
      if (!user.isAdmin) {
        return NextResponse.json(
          { error: "Only administrators can change program visibility" },
          { status: 403 }
        );
      }

      if (typeof is_active !== "boolean") {
        return NextResponse.json({ error: "is_active must be a boolean" }, { status: 400 });
      }
      updates.is_active = is_active;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const program = await updateProgram(id, updates);

    return NextResponse.json({ program });
  } catch (error) {
    console.error("Error updating program:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to update program" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check authentication
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;

    // Check if program exists and user owns it
    const existingProgram = await getProgramById(id);
    if (!existingProgram) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    // Debug logging
    console.log("DELETE attempt:", {
      userWallet: user.walletAddress,
      userId: user.userId,
      isAdmin: user.isAdmin,
      programId: id,
      programOwnerId: existingProgram.owner_id,
    });

    const isProgramOwner = !!existingProgram.owner_id && existingProgram.owner_id === user.userId;

    // Only admins can delete programs. Owners can delete their own user-created programs.
    if (!user.isAdmin && !isProgramOwner) {
      console.log("DELETE DENIED: User is not admin and does not own program");
      return NextResponse.json(
        { error: "Only administrators can delete programs" },
        { status: 403 }
      );
    }

    console.log("DELETE ALLOWED");

    await deleteProgram(id);

    return NextResponse.json({ message: "Program deleted successfully" });
  } catch (error) {
    console.error("Error deleting program:", error);

    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Failed to delete program" }, { status: 500 });
  }
}
