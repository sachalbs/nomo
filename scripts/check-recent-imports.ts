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

  console.log("=== Vérification des imports récents ===\n");

  // Get all distinct code_name values
  const { data: allArticles } = await supabase
    .from("law_articles")
    .select("code_name, created_at")
    .order("created_at", { ascending: false });

  if (allArticles) {
    const codeCounts = allArticles.reduce((acc, article) => {
      acc[article.code_name] = (acc[article.code_name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log("Tous les codes dans la base :\n");
    Object.entries(codeCounts).forEach(([code, count]) => {
      console.log(`"${code}": ${count} articles`);
    });

    // Show most recent imports
    console.log("\n=== 10 derniers articles importés ===\n");
    allArticles.slice(0, 10).forEach((article, i) => {
      console.log(`${i + 1}. Code: "${article.code_name}" - Created: ${article.created_at}`);
    });

    // Check total
    console.log(`\n=== Total ===`);
    console.log(`Total articles dans la base: ${allArticles.length}`);
  }

  // Try to find articles with similar names
  console.log("\n=== Recherche de variations du nom ===\n");

  const variations = [
    "Code de procédure pénale",
    "Code de procedure penale",
    "Code de procédure penale",
    "Code de procedure pénale",
  ];

  for (const variation of variations) {
    const { count } = await supabase
      .from("law_articles")
      .select("*", { count: "exact", head: true })
      .eq("code_name", variation);

    if (count && count > 0) {
      console.log(`"${variation}": ${count} articles`);
    }
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
