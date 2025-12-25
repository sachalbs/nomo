import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const BATCH_SIZE = 100;

async function main() {
  console.log("=== Fix Legifrance URLs ===\n");
  console.log("Removing date suffix from URLs...\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Count total articles
  const { count: totalCount } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true });

  console.log(`Total articles in database: ${totalCount}\n`);

  // Find articles with date suffix in URL (format: /YYYY-MM-DD at end)
  const { data: articlesToFix, error: fetchError } = await supabase
    .from("law_articles")
    .select("id, source_url")
    .like("source_url", "%/____-__-__");

  if (fetchError) {
    console.error("Error fetching articles:", fetchError);
    process.exit(1);
  }

  if (!articlesToFix || articlesToFix.length === 0) {
    console.log("All URLs already in correct format. Nothing to fix!");
    return;
  }

  console.log(`Found ${articlesToFix.length} articles to fix\n`);

  // Process in batches
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < articlesToFix.length; i += BATCH_SIZE) {
    const batch = articlesToFix.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(articlesToFix.length / BATCH_SIZE);

    console.log(`Processing batch ${batchNum}/${totalBatches}...`);

    for (const article of batch) {
      // Remove date suffix from URL
      // From: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI.../2025-12-24
      // To: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI...
      const newUrl = article.source_url?.replace(/\/\d{4}-\d{2}-\d{2}$/, "");

      if (!newUrl || newUrl === article.source_url) {
        console.error(`  Could not fix URL: ${article.source_url}`);
        errorCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from("law_articles")
        .update({ source_url: newUrl })
        .eq("id", article.id);

      if (updateError) {
        console.error(`  Error updating ${article.id}:`, updateError);
        errorCount++;
      } else {
        successCount++;
      }
    }

    console.log(`  Batch ${batchNum} done (${successCount} success, ${errorCount} errors)`);
  }

  console.log("\n=== Summary ===");
  console.log(`Total processed: ${articlesToFix.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  // Verify fix
  console.log("\n=== Verification ===");
  const { data: sampleArticles } = await supabase
    .from("law_articles")
    .select("article_number, source_url")
    .limit(3);

  if (sampleArticles) {
    console.log("Sample URLs after fix:");
    sampleArticles.forEach((a) => {
      console.log(`  ${a.article_number}: ${a.source_url}`);
    });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
