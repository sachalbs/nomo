import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  console.log("=== Diagnostic des URLs Légifrance ===\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get 10 sample articles
  const { data: articles, error } = await supabase
    .from("law_articles")
    .select("id, code_name, article_number, source_url")
    .limit(10);

  if (error) {
    console.error("Error fetching articles:", error);
    process.exit(1);
  }

  if (!articles || articles.length === 0) {
    console.log("No articles found in database.");
    return;
  }

  console.log(`Found ${articles.length} sample articles:\n`);

  // Valid format: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI... (without date)
  const expectedPattern = /^https:\/\/www\.legifrance\.gouv\.fr\/codes\/article_lc\/LEGIARTI\d+$/;

  let validCount = 0;
  let invalidCount = 0;

  for (const article of articles) {
    const isValid = expectedPattern.test(article.source_url || "");
    const status = isValid ? "✓" : "✗";

    if (isValid) validCount++;
    else invalidCount++;

    console.log(`${status} ${article.code_name} - ${article.article_number}`);
    console.log(`  URL: ${article.source_url || "(empty)"}`);
    console.log("");
  }

  console.log("---");
  console.log(`Valid URLs: ${validCount}/${articles.length}`);
  console.log(`Invalid URLs: ${invalidCount}/${articles.length}`);

  // Check total count and URL patterns
  const { count: totalCount } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true });

  console.log(`\nTotal articles in database: ${totalCount}`);

  // Check for empty URLs
  const { count: emptyCount } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true })
    .or("source_url.is.null,source_url.eq.");

  console.log(`Articles with empty URLs: ${emptyCount}`);

  // Check for URLs not matching expected pattern
  const { data: badUrls } = await supabase
    .from("law_articles")
    .select("source_url")
    .not("source_url", "like", "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI%")
    .limit(5);

  if (badUrls && badUrls.length > 0) {
    console.log("\nExamples of non-standard URLs:");
    badUrls.forEach((a) => console.log(`  ${a.source_url}`));
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
