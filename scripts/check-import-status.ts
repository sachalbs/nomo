import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("=== Import Status Check ===\n");

  // Get count for Code de procédure pénale
  const { count, error } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true })
    .eq("code_name", "Code de procédure pénale");

  if (error) {
    console.error("Error:", error);
    process.exit(1);
  }

  console.log(`Articles importés pour le Code de procédure pénale: ${count}`);
  console.log(`Articles restants à importer: ${4559 - (count || 0)}`);
  console.log(`Progression: ${((count || 0) / 4559 * 100).toFixed(1)}%`);

  // Get all codes in database
  console.log("\n=== Tous les codes dans la base ===\n");
  const { data: allCodes } = await supabase
    .from("law_articles")
    .select("code_name")
    .order("code_name");

  if (allCodes) {
    const codeCounts = allCodes.reduce((acc, article) => {
      acc[article.code_name] = (acc[article.code_name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(codeCounts).forEach(([code, count]) => {
      console.log(`${code}: ${count} articles`);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
