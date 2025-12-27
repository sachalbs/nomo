// @ts-nocheck
/**
 * Test RAG Quality - Jurisprudences Landmarks
 *
 * Ce script teste la qualité de la recherche RAG pour les arrêts essentiels.
 * Il vérifie que les bonnes jurisprudences sont remontées pour chaque requête.
 *
 * Usage: npx tsx scripts/test-rag-quality.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

// ============================================================================
// TYPES
// ============================================================================

interface CourtDecisionResult {
  id: string;
  case_number: string;
  jurisdiction: string;
  chambre: string;
  date_decision: string;
  summary: string;
  source_url: string;
  similarity: number;
  landmark_name?: string;
  title?: string;
}

interface TestCase {
  query: string;
  expected: string[];
  category: string;
}

interface TestResult {
  query: string;
  category: string;
  expected: string[];
  found: string[];
  matchedExpected: string[];
  missedExpected: string[];
  score: number;
  totalScore: number;
  success: boolean;
  results: CourtDecisionResult[];
}

// ============================================================================
// TEST CASES
// ============================================================================

const testCases: TestCase[] = [
  // Contrats - Vices du consentement
  {
    query: "jurisprudences sur le dol et la réticence dolosive",
    expected: ["Baldus", "Vilgrain"],
    category: "Contrats - Dol"
  },
  {
    query: "erreur sur la substance en droit des contrats",
    expected: ["Poussin", "Fragonard"],
    category: "Contrats - Erreur"
  },

  // Contrats - Clauses
  {
    query: "clause limitative de responsabilité",
    expected: ["Chronopost", "Faurecia"],
    category: "Contrats - Clauses"
  },
  {
    query: "obligation essentielle du contrat",
    expected: ["Chronopost", "Faurecia"],
    category: "Contrats - Obligation essentielle"
  },

  // Responsabilité civile
  {
    query: "responsabilité du fait d'autrui",
    expected: ["Blieck", "Costedoat", "Bertrand"],
    category: "Responsabilité - Fait d'autrui"
  },
  {
    query: "responsabilité parentale enfant mineur",
    expected: ["Bertrand", "Fullenwarth", "Samda"],
    category: "Responsabilité - Parentale"
  },

  // Droit du travail - Plateformes
  {
    query: "requalification contrat de travail livreurs plateformes",
    expected: ["Uber", "Take Eat Easy", "Deliveroo"],
    category: "Travail - Plateformes"
  },
  {
    query: "vie privée salarié emails",
    expected: ["Nikon"],
    category: "Travail - Vie privée"
  },
  {
    query: "harcèlement moral au travail",
    expected: ["Abram", "Orange"],
    category: "Travail - Harcèlement"
  },

  // Famille
  {
    query: "GPA gestation pour autrui filiation",
    expected: ["Mennesson", "Labassée"],
    category: "Famille - GPA"
  },

  // Responsabilité produits
  {
    query: "responsabilité produits défectueux médicaments",
    expected: ["Médiator", "Dépakine", "PIP"],
    category: "Responsabilité - Produits"
  },

  // Environnement
  {
    query: "préjudice écologique environnement",
    expected: ["Erika"],
    category: "Responsabilité - Écologique"
  },

  // Droit des sociétés
  {
    query: "abus de majorité sociétés",
    expected: ["Flandin"],
    category: "Sociétés - Abus"
  },

  // Relations commerciales
  {
    query: "rupture brutale relations commerciales",
    expected: ["Les Maréchaux", "Coca-Cola"],
    category: "Commercial - Rupture"
  },

  // Droit européen
  {
    query: "primauté du droit européen",
    expected: ["Jacques Vabre"],
    category: "Européen - Primauté"
  },
];

// ============================================================================
// UTILITIES
// ============================================================================

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]/g, ""); // Keep only alphanumeric
}

function matchesExpected(result: CourtDecisionResult, expectedName: string): boolean {
  const normalizedExpected = normalizeString(expectedName);

  // Check landmark_name
  if (result.landmark_name) {
    const normalizedLandmark = normalizeString(result.landmark_name);
    if (normalizedLandmark.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedLandmark)) {
      return true;
    }
  }

  // Check title
  if (result.title) {
    const normalizedTitle = normalizeString(result.title);
    if (normalizedTitle.includes(normalizedExpected)) {
      return true;
    }
  }

  // Check summary
  if (result.summary) {
    const normalizedSummary = normalizeString(result.summary);
    if (normalizedSummary.includes(normalizedExpected)) {
      return true;
    }
  }

  return false;
}

function getResultName(result: CourtDecisionResult): string {
  return result.landmark_name || result.title || result.case_number || "Inconnu";
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function runTest(
  supabase: ReturnType<typeof createClient>,
  testCase: TestCase,
  matchCount: number = 20
): Promise<TestResult> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(testCase.query);

    // Search for court decisions
    const { data: results, error } = await supabase.rpc("match_court_decisions", {
      query_embedding: queryEmbedding,
      match_threshold: 0.3, // Lower threshold to catch more results
      match_count: matchCount,
    });

    if (error) {
      console.error(`  Error: ${error.message}`);
      return {
        query: testCase.query,
        category: testCase.category,
        expected: testCase.expected,
        found: [],
        matchedExpected: [],
        missedExpected: testCase.expected,
        score: 0,
        totalScore: testCase.expected.length,
        success: false,
        results: [],
      };
    }

    const courtDecisions = (results || []) as CourtDecisionResult[];

    // Check which expected results were found
    const matchedExpected: string[] = [];
    const found: string[] = [];

    for (const result of courtDecisions) {
      const name = getResultName(result);
      found.push(name);

      for (const expected of testCase.expected) {
        if (matchesExpected(result, expected) && !matchedExpected.includes(expected)) {
          matchedExpected.push(expected);
        }
      }
    }

    const missedExpected = testCase.expected.filter(e => !matchedExpected.includes(e));
    const score = matchedExpected.length;
    const totalScore = testCase.expected.length;

    return {
      query: testCase.query,
      category: testCase.category,
      expected: testCase.expected,
      found,
      matchedExpected,
      missedExpected,
      score,
      totalScore,
      success: score === totalScore,
      results: courtDecisions,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`  Exception: ${errorMsg}`);
    return {
      query: testCase.query,
      category: testCase.category,
      expected: testCase.expected,
      found: [],
      matchedExpected: [],
      missedExpected: testCase.expected,
      score: 0,
      totalScore: testCase.expected.length,
      success: false,
      results: [],
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(70));
  console.log("     TEST RAG NOMO - JURISPRUDENCES LANDMARKS");
  console.log("=".repeat(70));
  console.log("\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error("❌ Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check database stats
  const { count: landmarkCount } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true })
    .eq("is_landmark", true);

  console.log(`📊 Jurisprudences landmarks en base: ${landmarkCount}`);
  console.log(`📋 Cas de test: ${testCases.length}`);
  console.log("\n" + "-".repeat(70) + "\n");

  // Run all tests
  const results: TestResult[] = [];
  let totalScore = 0;
  let totalPossible = 0;

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`[${i + 1}/${testCases.length}] "${testCase.query}"`);
    console.log(`   📁 Catégorie: ${testCase.category}`);

    const result = await runTest(supabase, testCase);
    results.push(result);

    totalScore += result.score;
    totalPossible += result.totalScore;

    // Display results
    const foundDisplay = result.found.slice(0, 5).map(name => {
      const isMatch = result.matchedExpected.some(e =>
        normalizeString(name).includes(normalizeString(e)) ||
        normalizeString(e).includes(normalizeString(name))
      );
      return isMatch ? `${name} ✅` : name;
    }).join(", ");

    console.log(`   📋 Résultats: ${foundDisplay || "Aucun"}`);

    if (result.success) {
      console.log(`   ✅ Score: ${result.score}/${result.totalScore} (100%)`);
    } else if (result.score > 0) {
      const pct = Math.round((result.score / result.totalScore) * 100);
      console.log(`   ⚠️  Score: ${result.score}/${result.totalScore} (${pct}%)`);
      console.log(`   ❌ Manquants: ${result.missedExpected.join(", ")}`);
    } else {
      console.log(`   ❌ Score: 0/${result.totalScore} (0%)`);
      console.log(`   ❌ Manquants: ${result.missedExpected.join(", ")}`);
    }

    console.log("");

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================

  console.log("\n" + "=".repeat(70));
  console.log("                         RÉSUMÉ");
  console.log("=".repeat(70) + "\n");

  const successCount = results.filter(r => r.success).length;
  const partialCount = results.filter(r => !r.success && r.score > 0).length;
  const failedCount = results.filter(r => r.score === 0).length;

  const globalPct = Math.round((totalScore / totalPossible) * 100);

  console.log(`   📊 Score global: ${totalScore}/${totalPossible} (${globalPct}%)`);
  console.log("");
  console.log(`   ✅ Tests réussis:   ${successCount}/${testCases.length}`);
  console.log(`   ⚠️  Tests partiels: ${partialCount}/${testCases.length}`);
  console.log(`   ❌ Tests échoués:   ${failedCount}/${testCases.length}`);

  // Group results by category
  const byCategory = new Map<string, TestResult[]>();
  for (const result of results) {
    const cat = result.category.split(" - ")[0];
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(result);
  }

  console.log("\n   📁 Par catégorie:");
  for (const [category, catResults] of byCategory) {
    const catScore = catResults.reduce((sum, r) => sum + r.score, 0);
    const catTotal = catResults.reduce((sum, r) => sum + r.totalScore, 0);
    const catPct = Math.round((catScore / catTotal) * 100);
    const icon = catPct === 100 ? "✅" : catPct >= 50 ? "⚠️" : "❌";
    console.log(`      ${icon} ${category}: ${catScore}/${catTotal} (${catPct}%)`);
  }

  // List problems
  const problemResults = results.filter(r => r.missedExpected.length > 0);
  if (problemResults.length > 0) {
    console.log("\n   🔍 Problèmes identifiés:");
    for (const result of problemResults) {
      console.log(`      - "${result.query.substring(0, 40)}..."`);
      console.log(`        Manquants: ${result.missedExpected.join(", ")}`);
    }
  }

  console.log("\n" + "=".repeat(70) + "\n");

  // Exit code based on results
  if (globalPct >= 80) {
    console.log("✅ Tests RAG passés avec succès!\n");
    process.exit(0);
  } else if (globalPct >= 50) {
    console.log("⚠️  Tests RAG partiellement réussis - améliorations nécessaires\n");
    process.exit(0);
  } else {
    console.log("❌ Tests RAG échoués - vérifier les embeddings\n");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
