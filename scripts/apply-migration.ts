import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  try {
    console.log("Reading migration file...");
    const migrationPath = join(process.cwd(), "supabase/migrations/003_add_auth_users.sql");
    const sql = readFileSync(migrationPath, "utf-8");

    console.log("Applying migration...");
    const { error } = await supabase.rpc("exec_sql", { sql_query: sql });

    if (error) {
      // Try direct approach if RPC doesn't work
      console.log("RPC approach failed, trying direct SQL execution...");

      // Split SQL into individual statements
      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        const { error: execError } = await supabase.rpc("exec", {
          query: statement,
        });

        if (execError) {
          console.error("Error executing statement:", execError);
          console.log("Statement:", statement);
        }
      }
    }

    console.log("✅ Migration applied successfully!");
    console.log("\nNext steps:");
    console.log("1. Add JWT_SECRET to your .env.local file");
    console.log("2. Restart your development server");
  } catch (error) {
    console.error("❌ Error applying migration:", error);
    process.exit(1);
  }
}

applyMigration();
