import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  console.log("=== Fix Legifrance URLs ===\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch all articles
  console.log("1. Fetching all articles...");
  const { data: articles, error } = await supabase
    .from("law_articles")
    .select("id, article_number, source_url")
    .eq("code_name", "Code civil");

  if (error) {
    console.error("Error fetching articles:", error);
    process.exit(1);
  }

  console.log(`   Found ${articles?.length || 0} articles\n`);

  if (!articles || articles.length === 0) {
    console.log("No articles found.");
    return;
  }

  // Check URLs
  console.log("2. Checking URLs...\n");

  const correctFormat = /^https:\/\/www\.legifrance\.gouv\.fr\/codes\/article_lc\/LEGIARTI\d+$/;
  const invalidArticles: typeof articles = [];
  const emptyUrls: typeof articles = [];
  const validArticles: typeof articles = [];

  for (const article of articles) {
    if (!article.source_url || article.source_url.trim() === "") {
      emptyUrls.push(article);
    } else if (!correctFormat.test(article.source_url)) {
      invalidArticles.push(article);
    } else {
      validArticles.push(article);
    }
  }

  console.log(`   Valid URLs: ${validArticles.length}`);
  console.log(`   Empty URLs: ${emptyUrls.length}`);
  console.log(`   Invalid URLs: ${invalidArticles.length}`);

  if (emptyUrls.length > 0) {
    console.log("\n   Articles with empty URLs:");
    emptyUrls.slice(0, 10).forEach((a) => {
      console.log(`     - ${a.article_number} (id: ${a.id})`);
    });
    if (emptyUrls.length > 10) {
      console.log(`     ... and ${emptyUrls.length - 10} more`);
    }
  }

  if (invalidArticles.length > 0) {
    console.log("\n   Articles with invalid URLs:");
    invalidArticles.slice(0, 10).forEach((a) => {
      console.log(`     - ${a.article_number}: ${a.source_url}`);
    });
    if (invalidArticles.length > 10) {
      console.log(`     ... and ${invalidArticles.length - 10} more`);
    }
  }

  // Show sample of valid URLs
  if (validArticles.length > 0) {
    console.log("\n   Sample valid URLs:");
    validArticles.slice(0, 3).forEach((a) => {
      console.log(`     - ${a.article_number}: ${a.source_url}`);
    });
  }

  console.log("\n=== Summary ===");
  console.log(`Total articles: ${articles.length}`);
  console.log(`Valid: ${validArticles.length} (${((validArticles.length / articles.length) * 100).toFixed(1)}%)`);
  console.log(`Need fixing: ${emptyUrls.length + invalidArticles.length}`);

  // If there are articles to fix, we would need to re-fetch from Legifrance API
  // For now, just report the status
  if (emptyUrls.length + invalidArticles.length > 0) {
    console.log("\nTo fix URLs, you need to:");
    console.log("1. Delete affected articles from the database");
    console.log("2. Re-run the import script: npm run import:legifrance");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
