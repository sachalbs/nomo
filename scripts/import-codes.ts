import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";
import * as fs from "fs";
import * as path from "path";

interface Article {
  code_name: string;
  article_number: string;
  content: string;
  legifrance_url: string;
}

const BATCH_SIZE = 5;
const RATE_LIMIT_DELAY = 1000; // 1 second between batches

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Validate environment variables
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  if (!mistralKey) {
    console.error("Missing MISTRAL_API_KEY environment variable");
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load articles from JSON file
  const dataPath = path.join(__dirname, "../data/code-civil-sample.json");
  const rawData = fs.readFileSync(dataPath, "utf-8");
  const articles: Article[] = JSON.parse(rawData);

  console.log(`Found ${articles.length} articles to import\n`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const progress = `[${i + 1}/${articles.length}]`;

    try {
      console.log(`${progress} Processing ${article.article_number}...`);

      // Generate embedding for the article content
      const textToEmbed = `${article.code_name} ${article.article_number}: ${article.content}`;
      const embedding = await generateEmbedding(textToEmbed);

      // Insert into database
      const { error } = await supabase.from("law_articles").insert({
        code_name: article.code_name,
        article_number: article.article_number,
        content: article.content,
        source_url: article.legifrance_url,
        embedding: embedding,
      });

      if (error) {
        throw error;
      }

      console.log(`${progress} Imported ${article.article_number}`);
      successCount++;

      // Rate limiting: pause between requests
      if (i < articles.length - 1) {
        await sleep(RATE_LIMIT_DELAY);
      }
    } catch (error) {
      console.error(`${progress} Error importing ${article.article_number}:`, error);
      errorCount++;
    }
  }

  console.log("\n--- Import Complete ---");
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
}

main().catch(console.error);
