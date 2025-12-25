import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const CODE_NAME = "Code de procédure pénale";

async function main() {
  console.log("=== Vérification de la base de données Supabase ===\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Variables d'environnement Supabase manquantes");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Count articles for Code de procédure pénale
  const { count, error } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true })
    .eq("code_name", CODE_NAME);

  if (error) {
    console.error("Erreur:", error);
    process.exit(1);
  }

  console.log(`Articles "${CODE_NAME}" dans Supabase : ${count || 0}`);

  // Get all codes
  const { data: allArticles } = await supabase
    .from("law_articles")
    .select("code_name, article_number, created_at")
    .eq("code_name", CODE_NAME)
    .order("created_at", { ascending: false })
    .limit(20);

  if (allArticles && allArticles.length > 0) {
    console.log(`\n20 derniers articles importés pour "${CODE_NAME}" :`);
    allArticles.forEach((article, i) => {
      const date = new Date(article.created_at).toLocaleString('fr-FR');
      console.log(`${i + 1}. ${article.article_number} - ${date}`);
    });
  } else {
    console.log(`\nAucun article trouvé pour "${CODE_NAME}"`);
  }

  // Total by code
  console.log("\n=== Tous les codes dans la base ===");
  const { data: allCodes } = await supabase
    .from("law_articles")
    .select("code_name");

  if (allCodes) {
    const counts = allCodes.reduce((acc, article) => {
      acc[article.code_name] = (acc[article.code_name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([code, count]) => {
        console.log(`${code}: ${count} articles`);
      });

    console.log(`\nTotal articles dans la base: ${allCodes.length}`);
  }
}

main().catch((error) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
