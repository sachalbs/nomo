/**
 * Script de test de qualite pour Nomo
 * Teste directement le RAG (Mistral embeddings + Supabase) et Claude
 *
 * Usage: npx tsx scripts/test-nomo-quality.ts
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "dotenv";

// Load environment variables
config({ path: ".env.local" });

// Configuration
const LLM_CHAT = "Claude Sonnet 4 (claude-sonnet-4-20250514)";
const LLM_EMBED = "Mistral Embed (mistral-embed)";

interface TestCase {
  question: string;
  expectedArticles: string[];
  description: string;
}

interface LawArticle {
  id: string;
  article_number: string;
  code_name: string;
  content: string;
  source_url: string;
  similarity: number;
}

interface TestResult {
  question: string;
  passed: boolean;
  responseTime: number;
  ragTime: number;
  llmTime: number;
  hasResponse: boolean;
  hasSources: boolean;
  foundArticles: string[];
  expectedArticles: string[];
  matchedArticles: string[];
  responsePreview?: string;
  error?: string;
}

const TEST_CASES: TestCase[] = [
  {
    question: "Quels sont les vices du consentement ?",
    expectedArticles: ["1130", "1131", "1132", "1133", "1137", "1139", "1140", "1143"],
    description: "Vices du consentement",
  },
  {
    question: "C'est quoi l'article 1240 du Code civil ?",
    expectedArticles: ["1240"],
    description: "Responsabilite delictuelle",
  },
  {
    question: "Quelles sont les conditions de validite d'un contrat ?",
    expectedArticles: ["1128", "1129", "1130"],
    description: "Conditions de validite du contrat",
  },
  {
    question: "C'est quoi la responsabilite du fait des choses ?",
    expectedArticles: ["1242", "1243", "1244"],
    description: "Responsabilite du fait des choses",
  },
  {
    question: "Dans quelle mesure une clause limitative de responsabilite peut-elle etre ecartee ?",
    expectedArticles: ["1170", "1171"],
    description: "Clauses limitatives de responsabilite",
  },
];

// Generate embedding using Mistral API
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch("https://api.mistral.ai/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-embed",
      input: [text],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function testQuestion(
  testCase: TestCase,
  supabase: ReturnType<typeof createClient>,
  anthropic: Anthropic
): Promise<TestResult> {
  const startTime = Date.now();
  let ragTime = 0;
  let llmTime = 0;

  try {
    // Step 1: Generate embedding (RAG)
    const ragStart = Date.now();
    const queryEmbedding = await generateEmbedding(testCase.question);

    // Step 2: Search for similar law articles
    const { data: articles, error: articlesError } = await supabase.rpc(
      "match_law_articles",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.55,
        match_count: 5,
      }
    );

    ragTime = Date.now() - ragStart;

    if (articlesError) {
      throw new Error(`Supabase error: ${articlesError.message}`);
    }

    // Extract found articles
    const sources: LawArticle[] = articles || [];
    const foundArticles: string[] = [];

    for (const source of sources) {
      const match = source.article_number?.match(/\d+/);
      if (match) {
        foundArticles.push(match[0]);
      }
    }

    // Check matched articles
    const matchedArticles = testCase.expectedArticles.filter((expected) =>
      foundArticles.some((found) => found === expected)
    );

    // Step 3: Call Claude
    const llmStart = Date.now();

    const articlesText = sources
      .map((s) => `[${s.article_number} - ${s.code_name}]\n${s.content}`)
      .join("\n\n");

    const systemPrompt = sources.length > 0
      ? `Tu es Nomo, un assistant juridique.

ARTICLES DE LOI :
${articlesText}

Reponds en utilisant ces sources.`
      : `Tu es Nomo, un assistant juridique. Aucune source trouvee.`;

    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: testCase.question }],
    });

    llmTime = Date.now() - llmStart;

    const textContent = claudeResponse.content.find((c) => c.type === "text");
    const response = textContent?.text || "";

    const responseTime = Date.now() - startTime;
    const hasResponse = response.length > 50;
    const hasSources = sources.length > 0;
    const hasExpectedArticle = matchedArticles.length > 0;

    const passed = hasResponse && hasSources && hasExpectedArticle && responseTime < 60000;

    return {
      question: testCase.question,
      passed,
      responseTime,
      ragTime,
      llmTime,
      hasResponse,
      hasSources,
      foundArticles,
      expectedArticles: testCase.expectedArticles,
      matchedArticles,
      responsePreview: response.substring(0, 100) + "...",
    };
  } catch (error) {
    return {
      question: testCase.question,
      passed: false,
      responseTime: Date.now() - startTime,
      ragTime,
      llmTime,
      hasResponse: false,
      hasSources: false,
      foundArticles: [],
      expectedArticles: testCase.expectedArticles,
      matchedArticles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  console.log("\n");
  console.log("=".repeat(65));
  console.log("              NOMO QUALITY TEST REPORT");
  console.log("=".repeat(65));
  console.log("\n");

  // Check environment variables
  const requiredEnvVars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "ANTHROPIC_API_KEY",
    "MISTRAL_API_KEY",
  ];

  const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingEnvVars.length > 0) {
    console.log("❌ Variables d'environnement manquantes:", missingEnvVars.join(", "));
    process.exit(1);
  }

  console.log("📋 Configuration");
  console.log("-".repeat(45));
  console.log(`   LLM Chat:     ${LLM_CHAT}`);
  console.log(`   LLM Embed:    ${LLM_EMBED}`);
  console.log(`   Supabase:     ${process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 35)}...`);
  console.log(`   Anthropic:    ✅ Configure`);
  console.log(`   Mistral:      ✅ Configure`);
  console.log("\n");

  // Initialize clients with extended timeout
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: {
        schema: "public",
      },
      global: {
        fetch: (url: RequestInfo | URL, options?: RequestInit) => {
          return fetch(url, {
            ...options,
            signal: AbortSignal.timeout(60000), // 60 seconds timeout
          });
        },
      },
    }
  );

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log("🧪 Tests en cours...");
  console.log("-".repeat(45));
  console.log("\n");

  const results: TestResult[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`   [${i + 1}/${TEST_CASES.length}] ${testCase.description}...`);

    const result = await testQuestion(testCase, supabase, anthropic);
    results.push(result);

    const status = result.passed ? "✅" : "❌";
    const time = `${(result.responseTime / 1000).toFixed(1)}s`;

    if (result.error) {
      console.log(`       ${status} ${time} - Erreur: ${result.error}`);
    } else {
      console.log(`       ${status} Total: ${time} (RAG: ${result.ragTime}ms, LLM: ${result.llmTime}ms)`);
      console.log(`          📚 Articles trouves:  [${result.foundArticles.join(", ")}]`);
      console.log(`          🎯 Articles attendus: [${result.expectedArticles.join(", ")}]`);
      console.log(`          ✨ Correspondances:   [${result.matchedArticles.join(", ") || "aucune"}]`);
    }

    console.log("");

    // Small delay between requests
    if (i < TEST_CASES.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Summary
  const passedTests = results.filter((r) => r.passed).length;
  const totalTests = results.length;
  const avgResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
  const avgRagTime = results.reduce((sum, r) => sum + r.ragTime, 0) / results.length;
  const avgLlmTime = results.reduce((sum, r) => sum + r.llmTime, 0) / results.length;

  console.log("\n");
  console.log("=".repeat(65));
  console.log("                        RESULTATS");
  console.log("=".repeat(65));
  console.log("\n");

  const scoreEmoji = passedTests === totalTests ? "🎉" : passedTests >= totalTests / 2 ? "👍" : "⚠️";
  const scorePercent = Math.round((passedTests / totalTests) * 100);

  console.log(`   ${scoreEmoji} Score global: ${passedTests}/${totalTests} tests reussis (${scorePercent}%)`);
  console.log("");
  console.log("   ⏱️  Performances moyennes:");
  console.log(`       Total:  ${(avgResponseTime / 1000).toFixed(1)}s`);
  console.log(`       RAG:    ${Math.round(avgRagTime)}ms`);
  console.log(`       LLM:    ${Math.round(avgLlmTime)}ms`);
  console.log("");
  console.log("   🤖 Stack technique:");
  console.log(`       Chat:   ${LLM_CHAT}`);
  console.log(`       Embed:  ${LLM_EMBED}`);
  console.log("\n");

  // Detailed results table
  console.log("   Resume par test:");
  console.log("-".repeat(65));
  console.log("   Status | Temps  | Reponse | Sources | Match | Question");
  console.log("-".repeat(65));

  for (const result of results) {
    const status = result.passed ? "  ✅  " : "  ❌  ";
    const time = `${(result.responseTime / 1000).toFixed(1)}s`.padEnd(6);
    const hasResp = result.hasResponse ? "  ✅   " : "  ❌   ";
    const hasSrc = result.hasSources ? "  ✅   " : "  ❌   ";
    const hasMatch = result.matchedArticles.length > 0 ? " ✅  " : " ❌  ";
    const question = result.question.substring(0, 25) + "...";
    console.log(`   ${status} | ${time} | ${hasResp} | ${hasSrc} | ${hasMatch} | ${question}`);
  }

  console.log("\n");
  console.log("=".repeat(65));
  console.log("\n");

  // Exit with appropriate code
  process.exit(passedTests === totalTests ? 0 : 1);
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
