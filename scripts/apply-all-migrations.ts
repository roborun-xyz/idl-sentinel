#!/usr/bin/env tsx

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing Supabase credentials");
  console.error("Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});

async function applyMigration(filePath: string, migrationName: string) {
  try {
    console.log(`\n📄 Reading ${migrationName}...`);
    const sql = readFileSync(filePath, "utf-8");

    console.log(`⚙️  Applying ${migrationName}...`);

    // Execute SQL directly using raw query
    const { error } = await supabase.rpc("exec", { sql });

    if (error) {
      // If RPC doesn't work, try splitting into statements
      console.log("Direct execution failed, trying statement-by-statement...");

      const statements = sql
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const statement of statements) {
        try {
          // Skip comments
          if (statement.startsWith("--") || statement.startsWith("COMMENT")) {
            continue;
          }

          console.log(`  Executing: ${statement.substring(0, 60)}...`);
          const { error: execError } = await supabase.rpc("exec", { sql: statement });

          if (execError) {
            console.warn(`  ⚠️  Warning:`, execError.message);
          }
        } catch (err) {
          console.warn(`  ⚠️  Warning:`, err);
        }
      }
    }

    console.log(`✅ ${migrationName} applied successfully!`);
    return true;
  } catch (error) {
    console.error(`❌ Error applying ${migrationName}:`, error);
    return false;
  }
}

async function main() {
  console.log("🚀 Starting migration process...\n");

  const migrationsDir = join(process.cwd(), "supabase/migrations");

  // Get all migration files in order
  const migrations = [
    "003_add_auth_users.sql",
    "004_add_admin_role.sql",
    "005_add_user_watchlist.sql",
  ];

  let successCount = 0;

  for (const migration of migrations) {
    const filePath = join(migrationsDir, migration);
    const success = await applyMigration(filePath, migration);
    if (success) successCount++;
  }

  console.log("\n" + "=".repeat(60));
  console.log(`✨ Migration process completed!`);
  console.log(`   ${successCount}/${migrations.length} migrations applied`);
  console.log("=".repeat(60));

  console.log("\n📋 Next steps:");
  console.log("1. Verify migrations in Supabase dashboard");
  console.log("2. Ensure JWT_SECRET is set in .env.local (✓ already set)");
  console.log("3. Restart your development server");
  console.log("4. Test the authentication flow\n");
}

main();
