import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function checkArticle() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Searching for Article 108 in Code de procédure pénale...\n");

  // Search by article number
  const { data: articles, error } = await supabase
    .from("law_articles")
    .select("id, code_name, article_number, content")
    .eq("code_name", "Code de procédure pénale")
    .ilike("article_number", "%108%")
    .limit(10);

  if (error) {
    console.error("Error:", error);
    process.exit(1);
  }

  if (!articles || articles.length === 0) {
    console.log("❌ Article 108 NOT FOUND in database");

    // Check total count for Code de procédure pénale
    const { count } = await supabase
      .from("law_articles")
      .select("*", { count: "exact", head: true })
      .eq("code_name", "Code de procédure pénale");

    console.log(`\nTotal articles in Code de procédure pénale: ${count || 0}`);
  } else {
    console.log(`✅ Found ${articles.length} article(s):\n`);
    articles.forEach((article) => {
      console.log(`Article: ${article.article_number}`);
      console.log(`Code: ${article.code_name}`);
      console.log(`Content preview: ${article.content.substring(0, 200)}...`);
      console.log("---");
    });
  }
}

checkArticle().catch(console.error);
