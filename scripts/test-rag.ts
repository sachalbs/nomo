import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

interface LawArticleSource {
  id: string;
  code_name: string;
  article_number: string;
  content: string;
  source_url: string;
  similarity: number;
}

const testQuestions = [
  // Code civil - Contrats
  "Quels sont les vices du consentement ?",
  "C'est quoi l'article 1240 ?",
  "Explique la force obligatoire du contrat",

  // Code civil - Responsabilité
  "C'est quoi la responsabilité du fait des choses ?",
  "Explique l'article 1242",

  // Code du travail
  "C'est quoi un CDI ?",
  "Quelles sont les conditions du licenciement ?",

  // Code de commerce
  "C'est quoi un acte de commerce ?",

  // Général
  "Quels sont les éléments constitutifs d'un contrat ?",
];

async function checkUrl(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function testQuestion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  question: string,
  skipUrlCheck: boolean
): Promise<{
  question: string;
  sourcesFound: number;
  sources: { article: string; url: string; urlOk: boolean; status: number }[];
  success: boolean;
}> {
  try {
    // Generate embedding
    const queryEmbedding = await generateEmbedding(question);

    // Search for similar law articles
    const { data: sources, error } = await supabase.rpc("match_law_articles", {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
    });

    if (error) {
      console.error(`  Error: ${error.message}`);
      return {
        question,
        sourcesFound: 0,
        sources: [],
        success: false,
      };
    }

    const matchedSources = (sources || []) as LawArticleSource[];
    const sourceResults: {
      article: string;
      url: string;
      urlOk: boolean;
      status: number;
    }[] = [];

    for (const source of matchedSources) {
      let urlOk = true;
      let status = 200;

      if (!skipUrlCheck) {
        const urlResult = await checkUrl(source.source_url);
        urlOk = urlResult.ok;
        status = urlResult.status;
      }

      sourceResults.push({
        article: `${source.article_number} (${source.code_name})`,
        url: source.source_url,
        urlOk,
        status,
      });
    }

    return {
      question,
      sourcesFound: matchedSources.length,
      sources: sourceResults,
      success: matchedSources.length > 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  Error: ${errorMsg}`);
    return {
      question,
      sourcesFound: 0,
      sources: [],
      success: false,
    };
  }
}

async function main() {
  console.log("=== Test RAG - Nomo ===\n");

  // Check for --skip-url-check flag
  const skipUrlCheck = process.argv.includes("--skip-url-check");
  if (skipUrlCheck) {
    console.log("(Skipping URL checks - Legifrance blocks automated requests)\n");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
  }

  if (!mistralKey) {
    console.error("Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check database has articles
  const { count } = await supabase
    .from("law_articles")
    .select("*", { count: "exact", head: true });

  console.log(`Articles in database: ${count}\n`);
  console.log("---\n");

  const results: Awaited<ReturnType<typeof testQuestion>>[] = [];
  let totalUrls = 0;
  let validUrls = 0;

  for (let i = 0; i < testQuestions.length; i++) {
    const question = testQuestions[i];
    console.log(`Question ${i + 1}/${testQuestions.length}: "${question}"`);

    const result = await testQuestion(supabase, question, skipUrlCheck);
    results.push(result);

    if (result.sourcesFound > 0) {
      console.log(`  ✅ Sources trouvées: ${result.sourcesFound}`);
      for (const source of result.sources) {
        totalUrls++;
        if (skipUrlCheck) {
          console.log(`     - ${source.article}`);
          validUrls++; // Assume valid when skipping check
        } else if (source.urlOk) {
          console.log(`     ✅ ${source.article} - URL OK (${source.status})`);
          validUrls++;
        } else {
          console.log(
            `     ❌ ${source.article} - URL FAILED (${source.status})`
          );
        }
      }
    } else {
      console.log(`  ❌ Aucune source trouvée`);
    }

    console.log("");

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Summary
  console.log("---");
  console.log("=== RÉSUMÉ ===\n");

  const questionsWithSources = results.filter((r) => r.success).length;
  const questionsWithoutSources = results.filter((r) => !r.success).length;

  if (questionsWithSources === testQuestions.length) {
    console.log(
      `✅ ${questionsWithSources}/${testQuestions.length} questions avec sources`
    );
  } else {
    console.log(
      `⚠️  ${questionsWithSources}/${testQuestions.length} questions avec sources`
    );
  }

  if (!skipUrlCheck) {
    if (validUrls === totalUrls) {
      console.log(`✅ ${validUrls}/${totalUrls} URLs valides`);
    } else {
      console.log(`⚠️  ${validUrls}/${totalUrls} URLs valides`);
    }
  }

  if (questionsWithoutSources > 0) {
    console.log(`\n❌ ${questionsWithoutSources} question(s) sans résultat:`);
    results
      .filter((r) => !r.success)
      .forEach((r) => {
        console.log(`   - "${r.question}"`);
      });
  }

  console.log("");

  // Exit with error if any question failed
  if (questionsWithoutSources > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
