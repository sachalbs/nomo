import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";
import {
  getTableMatieres,
  getArticle,
  extractArticleIds,
  cleanArticleText,
  buildLegifranceUrl,
} from "../lib/legifrance-api";

// Code de procédure civile
const CODE_ID = "LEGITEXT000006070716";
const CODE_NAME = "Code de procédure civile";

const RATE_LIMIT_DELAY = 1500; // 1.5 seconds between requests
const BATCH_SIZE = 10; // Save progress every N articles

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateEmbedding(text);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("Rate limit") && i < maxRetries - 1) {
        const waitTime = 2000 * (i + 1); // 2s, 4s, 6s
        console.log(`   Rate limited, waiting ${waitTime / 1000}s...`);
        await sleep(waitTime);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

async function main() {
  console.log(`=== Import ${CODE_NAME} ===\n`);

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const pisteClientId = process.env.PISTE_CLIENT_ID;
  const pisteClientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  if (!mistralKey) {
    console.error("Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  if (!pisteClientId || !pisteClientSecret) {
    console.error("Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
    process.exit(1);
  }

  console.log("✓ Environment variables validated");
  console.log(`✓ Supabase URL: ${supabaseUrl}`);
  console.log(`✓ Code ID: ${CODE_ID}`);
  console.log(`✓ Code Name: ${CODE_NAME}\n`);

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Step 1: Get table des matieres
  console.log("1. Fetching table des matieres...");
  let tableDesMatieres;
  try {
    tableDesMatieres = await getTableMatieres(CODE_ID);
    console.log("   ✓ Table des matieres retrieved successfully\n");
  } catch (error) {
    console.error("   ✗ Failed to fetch table des matieres:", error);
    process.exit(1);
  }

  // Step 2: Extract all article IDs
  console.log("2. Extracting article IDs...");
  const articleRefs = extractArticleIds(tableDesMatieres.sections);
  console.log(`   ✓ Found ${articleRefs.length} articles in force\n`);

  // Step 3: Check existing articles to resume import
  console.log("3. Checking existing articles in database...");
  const { data: existingArticles, error: fetchError } = await supabase
    .from("law_articles")
    .select("article_number")
    .eq("code_name", CODE_NAME);

  if (fetchError) {
    console.error("   ✗ Error fetching existing articles:", fetchError);
    process.exit(1);
  }

  const existingSet = new Set(
    existingArticles?.map((a) => a.article_number) || []
  );
  console.log(`   ✓ Found ${existingSet.size} existing articles in database\n`);

  // Filter out already imported articles
  const articlesToImport = articleRefs.filter(
    (ref) => !existingSet.has(`Article ${ref.num}`)
  );
  console.log(`   → ${articlesToImport.length} articles to import\n`);

  if (articlesToImport.length === 0) {
    console.log("✓ All articles already imported. Done!");

    // Final verification
    const { count } = await supabase
      .from("law_articles")
      .select("*", { count: "exact", head: true })
      .eq("code_name", CODE_NAME);

    console.log(`\nTotal ${CODE_NAME} articles in database: ${count}`);
    return;
  }

  // Step 4: Import articles
  console.log("4. Starting import...\n");
  console.log(`   Rate limit: ${RATE_LIMIT_DELAY}ms between requests`);
  console.log(`   Batch size: ${BATCH_SIZE} articles\n`);

  let successCount = 0;
  let errorCount = 0;
  const errors: { num: string; error: string }[] = [];

  for (let i = 0; i < articlesToImport.length; i++) {
    const { id, num } = articlesToImport[i];
    const progress = `[${i + 1}/${articlesToImport.length}]`;

    try {
      // Fetch article content
      const articleData = await getArticle(id);
      const article = articleData.article;

      // Clean the text
      const cleanText = cleanArticleText(article.texteHtml || article.texte);

      if (!cleanText || cleanText.length < 10) {
        console.log(`${progress} ⊘ Skipping Article ${num} (empty content)`);
        continue;
      }

      // Generate embedding with retry logic
      const textToEmbed = `${CODE_NAME} Article ${num}: ${cleanText}`;
      const embedding = await generateEmbeddingWithRetry(textToEmbed);

      // Insert into database
      const { error: insertError } = await supabase.from("law_articles").insert({
        code_name: CODE_NAME,
        article_number: `Article ${num}`,
        content: cleanText,
        source_url: buildLegifranceUrl(id),
        embedding,
      });

      if (insertError) {
        console.error(`${progress} ✗ Database insert error for Article ${num}:`, insertError);
        throw insertError;
      }

      successCount++;
      console.log(`${progress} ✓ Imported Article ${num}`);

      // Rate limiting
      await sleep(RATE_LIMIT_DELAY);
    } catch (error) {
      errorCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ num, error: errorMsg });
      console.error(`${progress} ✗ Error importing Article ${num}: ${errorMsg}`);

      // Still apply rate limiting on error
      await sleep(RATE_LIMIT_DELAY);
    }

    // Progress summary every BATCH_SIZE articles
    if ((i + 1) % BATCH_SIZE === 0) {
      console.log(
        `\n--- Progress: ${i + 1}/${articlesToImport.length} (${successCount} success, ${errorCount} errors) ---\n`
      );
    }
  }

  // Final summary
  console.log("\n=== Import Complete ===");
  console.log(`Total processed: ${articlesToImport.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  if (errors.length > 0) {
    console.log("\n✗ Failed articles:");
    errors.forEach(({ num, error }) => {
      console.log(`  - Article ${num}: ${error}`);
    });
  }

  // Verify total count in database
  console.log("\n=== Database Verification ===");
  const { count, error: countError } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true })
    .eq("code_name", CODE_NAME);

  if (countError) {
    console.error("✗ Error verifying count:", countError);
  } else {
    console.log(`✓ Total ${CODE_NAME} articles in database: ${count}`);
    console.log(`✓ Expected: ${articleRefs.length}`);

    if (count === articleRefs.length) {
      console.log("\n🎉 Import complete! All articles successfully imported.");
    } else {
      console.log(`\n⚠️  Warning: Database has ${count} articles but expected ${articleRefs.length}`);
    }
  }
}

main().catch((error) => {
  console.error("\n✗ Fatal error:", error);
  process.exit(1);
});
