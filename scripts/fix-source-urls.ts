/**
 * Fix Source URLs for Court Decisions
 *
 * Ce script corrige les source_url des décisions de justice en utilisant l'API Judilibre.
 * Pour chaque décision avec un numéro de pourvoi, il récupère l'ID Judilibre correct.
 *
 * Usage: npx tsx scripts/fix-source-urls.ts [--all] [--dry-run] [--batch-size=N]
 *
 * Options:
 *   --all         Traite toutes les décisions (pas seulement les landmarks)
 *   --dry-run     Affiche les modifications sans les appliquer
 *   --batch-size  Nombre de décisions à traiter par batch (défaut: 100)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const PISTE_AUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const JUDILIBRE_API_URL = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const PROCESS_ALL = args.includes("--all");
const BATCH_SIZE = parseInt(args.find(a => a.startsWith("--batch-size="))?.split("=")[1] || "100");

let accessToken: string | null = null;
let tokenExpiry: number = 0;

// ============================================================================
// OAUTH
// ============================================================================

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
  }

  const response = await fetch(PISTE_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid",
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return accessToken!;
}

// ============================================================================
// JUDILIBRE API
// ============================================================================

interface JudilibreResult {
  id: string;
  number: string;
  decision_date: string;
  jurisdiction: string;
}

async function searchByNumber(numero: string): Promise<JudilibreResult | null> {
  const token = await getAccessToken();

  // Clean the numero - remove spaces and normalize
  const cleanNumero = numero.replace(/\s/g, "").trim();

  // Skip if it's not a valid pourvoi number format
  if (!cleanNumero.match(/^\d{2}-\d{2}\.\d{3}$/)) {
    return null;
  }

  const searchUrl = `${JUDILIBRE_API_URL}/search?query=${encodeURIComponent(cleanNumero)}&page_size=5`;

  try {
    const response = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 500) {
        // API temporarily unavailable
        return null;
      }
      console.error(`Search failed for ${numero}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data.results || data.results.length === 0) {
      return null;
    }

    // Find exact match
    const exactMatch = data.results.find((r: any) =>
      r.number && r.number.replace(/\s/g, "") === cleanNumero
    );

    if (exactMatch) {
      return {
        id: exactMatch.id,
        number: exactMatch.number,
        decision_date: exactMatch.decision_date,
        jurisdiction: exactMatch.jurisdiction,
      };
    }

    // Return first result if no exact match
    const first = data.results[0];
    return {
      id: first.id,
      number: first.number,
      decision_date: first.decision_date,
      jurisdiction: first.jurisdiction,
    };
  } catch (error) {
    console.error(`Error searching for ${numero}:`, error);
    return null;
  }
}

// ============================================================================
// FALLBACK: Build search URL
// ============================================================================

function buildSearchUrl(numero: string): string {
  const cleanNumero = numero.replace(/\s/g, "").trim();
  return `https://www.courdecassation.fr/recherche-judiliaire?search_api_fulltext=${encodeURIComponent(cleanNumero)}`;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(70));
  console.log("     CORRECTION DES SOURCE_URL");
  console.log("=".repeat(70));
  console.log("\n");

  console.log(`Mode: ${PROCESS_ALL ? "TOUTES les décisions" : "Landmarks uniquement"}`);
  console.log(`Dry run: ${DRY_RUN ? "OUI (aucune modification)" : "NON"}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log("\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // First, test if API is available
  console.log("Test de l'API Judilibre...");
  let apiAvailable = true;
  const testResult = await searchByNumber("98-11.381");
  if (!testResult) {
    console.log("⚠️  API Judilibre indisponible - utilisation des URLs de recherche\n");
    apiAvailable = false;
  } else {
    console.log("✅ API Judilibre disponible\n");
  }

  // Get total count first
  let countQuery = supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true })
    .not("case_number", "is", null);

  if (!PROCESS_ALL) {
    countQuery = countQuery.eq("is_landmark", true);
  }

  const { count: totalCount, error: countError } = await countQuery;

  if (countError) {
    console.error("Error counting decisions:", countError);
    process.exit(1);
  }

  console.log(`Total décisions à analyser: ${totalCount || 0}\n`);
  console.log("-".repeat(70));

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let apiSuccessCount = 0;
  let searchFallbackCount = 0;
  let processedCount = 0;
  let offset = 0;

  while (offset < (totalCount || 0)) {
    // Fetch batch
    let query = supabase
      .from("court_decisions")
      .select("id, landmark_name, title, case_number, source_url")
      .not("case_number", "is", null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (!PROCESS_ALL) {
      query = query.eq("is_landmark", true);
    }

    const { data: decisions, error } = await query;

    if (error) {
      console.error("Error fetching decisions:", error);
      break;
    }

    if (!decisions || decisions.length === 0) {
      break;
    }

    for (const decision of decisions) {
      processedCount++;
      const numero = decision.case_number;
      const progress = `[${processedCount}/${totalCount}]`;

      // Skip if no valid numero
      if (!numero || !numero.match(/^\d{2}-\d{2}\.\d{3}$/)) {
        // console.log(`${progress} [SKIP] numéro invalide: ${numero}`);
        skippedCount++;
        continue;
      }

      let newUrl: string | null = null;
      let source: string = "";

      if (apiAvailable) {
        // Try to get real ID from API
        const result = await searchByNumber(numero);

        if (result) {
          newUrl = `https://www.courdecassation.fr/decision/${result.id}`;
          source = "API";
          apiSuccessCount++;
        } else {
          // Fallback to search URL
          newUrl = buildSearchUrl(numero);
          source = "SEARCH";
          searchFallbackCount++;
        }
      } else {
        // Use search URL as fallback
        newUrl = buildSearchUrl(numero);
        source = "SEARCH";
        searchFallbackCount++;
      }

      // Check if URL changed
      if (decision.source_url === newUrl) {
        skippedCount++;
        continue;
      }

      console.log(`${progress} [${source}] ${numero} -> ${newUrl.substring(0, 60)}...`);

      if (!DRY_RUN) {
        // Update in database - use case_number as some landmarks don't have valid UUIDs
        const { error: updateError } = await supabase
          .from("court_decisions")
          .update({ source_url: newUrl })
          .eq("case_number", decision.case_number);

        if (updateError) {
          console.error(`  ❌ Erreur update: ${updateError.message}`);
          errorCount++;
        } else {
          updatedCount++;
        }
      } else {
        updatedCount++;
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, apiAvailable ? 200 : 20));
    }

    offset += BATCH_SIZE;

    // Progress update every batch
    console.log(`\n📊 Progression: ${processedCount}/${totalCount} (${Math.round(processedCount * 100 / (totalCount || 1))}%)\n`);
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("                         RÉSUMÉ");
  console.log("=".repeat(70));
  console.log(`\n   Décisions analysées:  ${processedCount}`);
  console.log(`   URLs mises à jour:    ${updatedCount}${DRY_RUN ? " (dry-run)" : ""}`);
  console.log(`   Inchangées:           ${skippedCount}`);
  console.log(`   Erreurs:              ${errorCount}`);
  if (apiAvailable) {
    console.log(`   Via API Judilibre:    ${apiSuccessCount}`);
  }
  console.log(`   Via URL recherche:    ${searchFallbackCount}`);
  console.log("\n" + "=".repeat(70) + "\n");
}

main().catch((error) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
