// @ts-nocheck
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  console.log("=== Test Supabase INSERT Permissions ===\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  console.log(`Supabase URL: ${supabaseUrl}`);
  console.log(`Using ANON KEY: ${supabaseKey.substring(0, 20)}...\n`);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Test 1: Try to insert a test article
  console.log("1. Testing INSERT permission...");

  const testArticle = {
    code_name: "Code de procédure pénale",
    article_number: "Article TEST-001",
    content: "Ceci est un article de test pour vérifier les permissions d'insertion.",
    source_url: "https://test.example.com",
    embedding: new Array(1024).fill(0), // Fake embedding vector
  };

  const { data: insertData, error: insertError } = await supabase
    .from("law_articles")
    .insert(testArticle)
    .select();

  if (insertError) {
    console.error("   ✗ INSERT FAILED!");
    console.error("   Error code:", insertError.code);
    console.error("   Error message:", insertError.message);
    console.error("   Error details:", insertError.details);
    console.error("   Error hint:", insertError.hint);

    if (insertError.code === "42501" || insertError.message.includes("policy")) {
      console.error("\n   ⚠️  This looks like a Row Level Security (RLS) policy issue!");
      console.error("   The ANON_KEY doesn't have INSERT permissions on law_articles table.");
      console.error("\n   Solution: Either disable RLS or add a policy that allows INSERT.");
    }
  } else {
    console.log("   ✓ INSERT successful!");
    console.log("   Inserted article:", insertData);

    // Clean up - delete the test article
    console.log("\n2. Cleaning up test article...");
    const { error: deleteError } = await supabase
      .from("law_articles")
      .delete()
      .eq("article_number", "Article TEST-001");

    if (deleteError) {
      console.error("   ✗ DELETE failed:", deleteError.message);
    } else {
      console.log("   ✓ Test article deleted");
    }
  }

  // Test 2: Check RLS status
  console.log("\n3. Checking table structure...");
  const { data: tables, error: tablesError } = await supabase
    .from("law_articles")
    .select("*")
    .limit(1);

  if (tablesError) {
    console.error("   ✗ SELECT failed:", tablesError.message);
  } else {
    console.log("   ✓ SELECT works fine");
    console.log("   Sample row:", tables?.[0] || "No rows");
  }
}

main().catch((error) => {
  console.error("\n✗ Fatal error:", error);
  process.exit(1);
});
