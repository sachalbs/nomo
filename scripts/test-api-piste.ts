// @ts-nocheck
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  getTableMatieres,
  getArticle,
  extractArticleIds,
} from "../lib/legifrance-api";

const CODE_ID = "LEGITEXT000006071154";
const CODE_NAME = "Code de procédure pénale";

async function main() {
  console.log("=== Test API PISTE - Code de procédure pénale ===\n");

  // Step 1: Validate environment variables
  console.log("1. Checking environment variables...");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;
  const pisteClientId = process.env.PISTE_CLIENT_ID;
  const pisteClientSecret = process.env.PISTE_CLIENT_SECRET;

  console.log(`   Supabase URL: ${supabaseUrl ? "✓" : "✗ MISSING"}`);
  console.log(`   Supabase Key: ${supabaseKey ? "✓" : "✗ MISSING"}`);
  console.log(`   Mistral API Key: ${mistralKey ? "✓" : "✗ MISSING"}`);
  console.log(`   PISTE Client ID: ${pisteClientId ? "✓" : "✗ MISSING"}`);
  console.log(`   PISTE Client Secret: ${pisteClientSecret ? "✓" : "✗ MISSING"}\n`);

  if (!supabaseUrl || !supabaseKey || !mistralKey || !pisteClientId || !pisteClientSecret) {
    console.error("✗ Missing required environment variables");
    process.exit(1);
  }

  // Step 2: Test API PISTE access
  console.log("2. Testing API PISTE access...");
  console.log(`   Code ID: ${CODE_ID}`);
  console.log(`   Code Name: ${CODE_NAME}\n`);

  let tableDesMatieres;
  let articleRefs;

  try {
    console.log("   Fetching table des matières from API PISTE...");
    tableDesMatieres = await getTableMatieres(CODE_ID);
    console.log("   ✓ Successfully retrieved table des matières\n");

    console.log("   Extracting article IDs...");
    articleRefs = extractArticleIds(tableDesMatieres.sections);
    console.log(`   ✓ Found ${articleRefs.length} articles in force\n`);

    // Show first 5 articles
    console.log("   First 5 articles:");
    articleRefs.slice(0, 5).forEach((ref, i) => {
      console.log(`     ${i + 1}. Article ${ref.num} (ID: ${ref.id})`);
    });
    console.log("");

  } catch (error) {
    console.error("   ✗ Failed to access API PISTE:", error);
    process.exit(1);
  }

  // Step 3: Test fetching a single article
  console.log("3. Testing article retrieval...");
  try {
    const firstArticle = articleRefs[0];
    console.log(`   Fetching Article ${firstArticle.num}...`);

    const articleData = await getArticle(firstArticle.id);
    const article = articleData.article;

    console.log(`   ✓ Successfully retrieved Article ${firstArticle.num}`);
    console.log(`   Article ID: ${article.id}`);
    console.log(`   Article number: ${article.num}`);
    console.log(`   Article state: ${article.etat}`);
    console.log(`   Content length: ${article.texte?.length || article.texteHtml?.length || 0} characters`);
    console.log(`   Content preview: ${(article.texte || article.texteHtml || "").substring(0, 100)}...\n`);
  } catch (error) {
    console.error("   ✗ Failed to retrieve article:", error);
  }

  // Step 4: Check Supabase database
  console.log("4. Checking Supabase database...");
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get total count for Code de procédure pénale
    const { count: totalCount, error: countError } = await supabase
      .from("law_articles")
      .select("*", { count: "exact", head: true })
      .eq("code_name", CODE_NAME);

    if (countError) {
      console.error("   ✗ Error querying database:", countError);
    } else {
      console.log(`   ✓ Articles in database for ${CODE_NAME}: ${totalCount}`);
      console.log(`   Expected total: ${articleRefs.length}`);
      console.log(`   Missing: ${articleRefs.length - (totalCount || 0)}`);
      console.log(`   Progress: ${((totalCount || 0) / articleRefs.length * 100).toFixed(1)}%\n`);
    }

    // Get recent articles
    const { data: recentArticles, error: recentError } = await supabase
      .from("law_articles")
      .select("article_number, created_at")
      .eq("code_name", CODE_NAME)
      .order("created_at", { ascending: false })
      .limit(5);

    if (recentError) {
      console.error("   ✗ Error fetching recent articles:", recentError);
    } else if (recentArticles && recentArticles.length > 0) {
      console.log("   Recent imports:");
      recentArticles.forEach((article, i) => {
        console.log(`     ${i + 1}. ${article.article_number} - ${new Date(article.created_at).toLocaleString()}`);
      });
      console.log("");
    } else {
      console.log("   No articles found in database for this code.\n");
    }

    // Check all codes in database
    const { data: allArticles } = await supabase
      .from("law_articles")
      .select("code_name");

    if (allArticles) {
      const codeCounts = allArticles.reduce((acc, article) => {
        acc[article.code_name] = (acc[article.code_name] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log("   All codes in database:");
      Object.entries(codeCounts).forEach(([code, count]) => {
        console.log(`     - ${code}: ${count} articles`);
      });
      console.log("");
    }

  } catch (error) {
    console.error("   ✗ Database error:", error);
  }

  // Step 5: Summary and recommendations
  console.log("=== Summary ===\n");
  console.log(`✓ API PISTE access: Working`);
  console.log(`✓ Articles available via API: ${articleRefs.length}`);

  const { count: dbCount } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true })
    .eq("code_name", CODE_NAME);

  console.log(`✓ Articles in database: ${dbCount || 0}`);

  if ((dbCount || 0) < articleRefs.length) {
    console.log(`\n⚠️  ${articleRefs.length - (dbCount || 0)} articles still need to be imported`);
    console.log("\nTo import the remaining articles, run:");
    console.log("  npm run import:procedure-penale");
  } else {
    console.log("\n🎉 All articles are imported!");
  }
}

main().catch((error) => {
  console.error("\n✗ Fatal error:", error);
  process.exit(1);
});
