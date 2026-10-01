import { NextRequest, NextResponse } from "next/server";
import { getAllPrograms, createProgram, getProgramCount } from "@/lib/db/programs";
import { isValidProgramId } from "@/lib/utils";
import { fetchInitialIdl } from "@/lib/monitoring/monitor";
import { getAuthUser } from "@/lib/auth/middleware";

export async function GET(request: NextRequest) {
  try {
    // Parse pagination parameters from query string
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset");
    const user = await getAuthUser(request);
    const activeOnly = searchParams.get("activeOnly") === "true" || !user?.isAdmin;
    const search = (searchParams.get("search") || "").trim().slice(0, 200);

    // Validate and parse pagination params
    const parsedLimit = limit ? Number(limit) : 50;
    const parsedOffset = offset ? Number(offset) : 0;

    // Validate limits
    if (
      parsedLimit !== undefined &&
      (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100)
    ) {
      return NextResponse.json(
        { error: "Invalid limit parameter. Must be between 1 and 100" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      return NextResponse.json(
        { error: "Invalid offset parameter. Must be >= 0" },
        { status: 400 }
      );
    }

    // Fetch programs with pagination
    const [programs, totalCount] = await Promise.all([
      getAllPrograms({
        limit: parsedLimit,
        offset: parsedOffset,
        activeOnly,
        search,
      }),
      getProgramCount({ activeOnly, search }),
    ]);

    return NextResponse.json({
      programs,
      pagination: {
        total: totalCount,
        limit: parsedLimit || totalCount,
        offset: parsedOffset,
        hasMore: parsedLimit ? parsedOffset + parsedLimit < totalCount : false,
      },
    });
  } catch (error) {
    console.error("Error fetching programs:", error);
    return NextResponse.json({ error: "Failed to fetch programs" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const user = await getAuthUser(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Only admins can create programs
    if (!user.isAdmin) {
      return NextResponse.json(
        { error: "Only administrators can create programs" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { program_id, name, description } = body;

    // Validation
    if (!program_id || !name) {
      return NextResponse.json({ error: "program_id and name are required" }, { status: 400 });
    }

    if (!isValidProgramId(program_id)) {
      return NextResponse.json({ error: "Invalid program_id format" }, { status: 400 });
    }

    if (name.length < 2 || name.length > 100) {
      return NextResponse.json(
        { error: "Name must be between 2 and 100 characters" },
        { status: 400 }
      );
    }

    if (description && description.length > 500) {
      return NextResponse.json(
        { error: "Description must be less than 500 characters" },
        { status: 400 }
      );
    }

    // Create the program in the database with owner
    const program = await createProgram(program_id, name, user.userId, description);

    // Attempt to fetch IDL immediately
    let idlResult = null;
    try {
      console.log(`Attempting immediate IDL fetch for program: ${program.name}`);
      idlResult = await fetchInitialIdl(program);
      console.log(`IDL fetch result:`, idlResult);
    } catch (error) {
      console.error("Error during immediate IDL fetch:", error);
      // Don't fail the program creation if IDL fetch fails
      idlResult = {
        success: false,
        snapshotCreated: false,
        idlFound: false,
        error: error instanceof Error ? error.message : "Unknown error during IDL fetch",
      };
    }

    // Return program with IDL fetch results
    return NextResponse.json(
      {
        program,
        idl_fetch: {
          attempted: true,
          success: idlResult.success,
          snapshot_created: idlResult.snapshotCreated,
          idl_found: idlResult.idlFound,
          error: idlResult.error || null,
          message: idlResult.idlFound
            ? "IDL successfully fetched and initial snapshot created"
            : idlResult.error || "IDL could not be fetched from the blockchain",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating program:", error);

    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes("duplicate key")) {
      return NextResponse.json({ error: "Program with this ID already exists" }, { status: 409 });
    }

    return NextResponse.json({ error: "Failed to create program" }, { status: 500 });
  }
}
