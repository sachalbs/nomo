import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface JudilibreDecision {
  id: string;
  jurisdiction: string;
  chamber: string;
  number: string;
  ecli: string;
  formation: string;
  publication: string[];
  decision_date: string;
  solution: string;
  type: string;
  themes: string[];
  files: any[];
  titlesAndSummaries: any; // Can be object, array, or string
}

interface SearchResponse {
  results: JudilibreDecision[];
  page_size: number;
  page: number;
  total: number;
}

const PISTE_AUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const JUDILIBRE_API_URL = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";
const RATE_LIMIT_DELAY = 3000; // 3 seconds between requests
const RETRY_DELAY = 30000; // 30 seconds wait on rate limit
const MAX_RETRIES = 3; // Maximum retry attempts
const MAX_DECISIONS = 1000; // Import 1000 decisions per batch
const PAGE_SIZE = 10;
const DEBUG_MODE = true; // Enable detailed logging

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateEmbeddingWithRetry(text: string): Promise<number[]> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      lastError = error as Error;
      const errorMessage = error instanceof Error ? error.message : String(error);

      console.log(`\n❌ EMBEDDING ERROR: ${errorMessage}`);

      // Check if it's a rate limit error (check message in lowercase for safety)
      const errorLower = errorMessage.toLowerCase();
      const isRateLimit =
        errorLower.includes("rate limit") ||
        errorLower.includes("rate_limit") ||
        errorLower.includes("ratelimit") ||
        errorLower.includes("429") ||
        errorLower.includes("too many requests") ||
        errorLower.includes("quota") ||
        errorLower.includes("exceeded");

      if (isRateLimit) {
        console.log(`⚠️  RATE LIMIT DETECTED! (attempt ${attempt}/${MAX_RETRIES})`);

        if (attempt < MAX_RETRIES) {
          console.log(`⏰ Pausing for ${RETRY_DELAY / 1000} seconds...`);
          await sleep(RETRY_DELAY);
          console.log(`🔄 Resuming - retrying embedding generation...\n`);
          continue;
        } else {
          console.log(`❌ Max retries (${MAX_RETRIES}) exhausted\n`);
        }
      } else {
        // Not a rate limit error - throw immediately
        throw error;
      }
    }
  }

  // If we exhausted all retries
  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

function extractTextFromTitlesAndSummaries(titlesAndSummaries: any): { title: string; summary: string; content: string } {
  let title = "";
  let summary = "";
  let content = "";

  if (!titlesAndSummaries) {
    return {
      title: "Décision sans titre",
      summary: "Décision sans résumé disponible",
      content: "Décision sans résumé disponible"
    };
  }

  // Handle different possible structures
  if (typeof titlesAndSummaries === "string") {
    content = titlesAndSummaries;
    summary = titlesAndSummaries;
    title = titlesAndSummaries.substring(0, 100);
  } else if (Array.isArray(titlesAndSummaries)) {
    // If it's an array, join all elements
    const texts = titlesAndSummaries.map(item =>
      typeof item === "string" ? item : JSON.stringify(item)
    );
    content = texts.join("\n\n");
    summary = texts.join("\n\n");
    title = texts[0]?.substring(0, 100) || "Décision sans titre";
  } else if (typeof titlesAndSummaries === "object") {
    // If it's an object, try to extract common fields
    const obj = titlesAndSummaries as any;
    title = obj.title || obj.titre || obj.name || "";
    summary = obj.summary || obj.sommaire || obj.resume || "";
    content = obj.content || obj.text || obj.texte || summary;

    // If no content found, stringify the whole object
    if (!content && !summary) {
      content = JSON.stringify(titlesAndSummaries);
      summary = content;
    }
  }

  // Fallback if still empty
  if (!content.trim()) {
    content = "Décision sans résumé disponible";
  }
  if (!summary.trim()) {
    summary = "Décision sans résumé disponible";
  }
  if (!title.trim()) {
    title = "Décision sans titre";
  }

  return { title, summary, content };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE credentials");
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
    const error = await response.text();
    throw new Error(`OAuth error: ${error}`);
  }

  const data: OAuthTokenResponse = await response.json();
  return data.access_token;
}

async function discoverAPI(accessToken: string): Promise<any> {
  const url = JUDILIBRE_API_URL;

  if (DEBUG_MODE) {
    console.log("📤 Discovery Request:");
    console.log(`  URL: ${url}`);
    console.log(`  Method: GET`);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const responseText = await response.text();

  if (DEBUG_MODE) {
    console.log(`📥 Discovery Response Status: ${response.status} ${response.statusText}`);
    console.log(`📥 Discovery Response Body:`);
    console.log(responseText);
    console.log("");
  }

  if (response.ok) {
    try {
      return JSON.parse(responseText);
    } catch (e) {
      return { raw: responseText };
    }
  }

  return null;
}

async function searchDecisions(
  accessToken: string,
  page: number = 0
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    query: "*",
    page: page.toString(),
    page_size: PAGE_SIZE.toString(),
  });

  const url = `${JUDILIBRE_API_URL}/search?${params.toString()}`;

  if (DEBUG_MODE) {
    console.log("📤 API Request:");
    console.log(`  URL: ${url}`);
    console.log(`  Method: GET`);
    console.log(`  Params: query=*, page=${page}, page_size=${PAGE_SIZE}`);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (DEBUG_MODE) {
    console.log(`📥 API Response Status: ${response.status} ${response.statusText}`);
  }

  const responseText = await response.text();

  if (DEBUG_MODE && page === 0) {
    console.log(`📥 API Response Body (first 1000 chars):`);
    console.log(responseText.substring(0, 1000));
    console.log("...\n");
  }

  if (!response.ok) {
    throw new Error(`Judilibre API error (${response.status}): ${responseText}`);
  }

  try {
    return JSON.parse(responseText);
  } catch (e) {
    throw new Error(`Failed to parse API response: ${responseText.substring(0, 200)}`);
  }
}

async function getDecision(
  accessToken: string,
  decisionId: string
): Promise<JudilibreDecision> {
  const url = `${JUDILIBRE_API_URL}/decision?${new URLSearchParams({
    id: decisionId,
  })}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Judilibre API error: ${error}`);
  }

  return await response.json();
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

  console.log("🔐 Authenticating with PISTE...");
  const accessToken = await getAccessToken();
  console.log("✅ Authentication successful\n");

  // Test API with a simple request first
  console.log("🧪 Testing API connection...");
  try {
    const testResponse = await searchDecisions(accessToken, 0);
    console.log(`✅ API test successful! Found ${testResponse.total} total decisions available`);

    if (DEBUG_MODE && testResponse.results && testResponse.results.length > 0) {
      console.log("\n📄 Sample decision structure:");
      const sample = testResponse.results[0];
      Object.keys(sample).forEach(key => {
        const value = (sample as any)[key];
        const preview = typeof value === 'string' && value.length > 50
          ? value.substring(0, 50) + '...'
          : value;
        console.log(`  ${key}: ${JSON.stringify(preview)}`);
      });
      console.log("");
    }
  } catch (error) {
    console.error("❌ API test failed:", error);
    console.error("\nPlease check:");
    console.error("1. Your PISTE credentials are correct");
    console.error("2. You have access to the Judilibre API");
    console.error("3. The API endpoint is correct");
    process.exit(1);
  }

  // Initialize Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Get count of existing decisions to resume from where we left off
  console.log("📊 Checking existing decisions in database...");
  const { count: existingCount, error: countError } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true });

  if (countError) {
    console.error("❌ Error counting existing decisions:", countError);
    process.exit(1);
  }

  const existingDecisions = existingCount || 0;
  const startPage = Math.floor(existingDecisions / PAGE_SIZE);

  console.log(`✅ Found ${existingDecisions} existing decisions`);
  console.log(`📄 Starting from page ${startPage + 1} (skipping first ${existingDecisions} decisions)\n`);

  let successCount = 0;
  let newCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  let processedCount = 0;
  let currentPage = startPage;

  console.log(`📥 Starting import of up to ${MAX_DECISIONS} new decisions...\n`);

  while (processedCount < MAX_DECISIONS) {
    try {
      console.log(`\n📄 Fetching page ${currentPage + 1}...`);
      const searchResults = await searchDecisions(accessToken, currentPage);

      if (DEBUG_MODE && currentPage === 0) {
        console.log("📋 Response structure:");
        console.log(`  Type: ${typeof searchResults}`);
        console.log(`  Keys: ${Object.keys(searchResults).join(", ")}`);
        console.log(`  Has results: ${!!searchResults.results}`);
        if (searchResults.results && searchResults.results.length > 0) {
          console.log(`  First result keys: ${Object.keys(searchResults.results[0]).join(", ")}`);
        }
      }

      if (!searchResults.results || searchResults.results.length === 0) {
        console.log("No more decisions found.");
        break;
      }

      console.log(
        `✅ Found ${searchResults.results.length} decisions (total: ${searchResults.total})\n`
      );

      for (const decision of searchResults.results) {
        if (processedCount >= MAX_DECISIONS) break;

        const progress = `[${processedCount + 1}/${Math.min(MAX_DECISIONS, searchResults.total)}]`;

        try {
          const decisionIdentifier = decision.number || decision.id || "unknown";
          console.log(`${progress} Processing decision ${decisionIdentifier}...`);

          // Debug: Show titlesAndSummaries structure for first decision
          if (processedCount === 0 && DEBUG_MODE) {
            console.log("\n📋 DEBUG - titlesAndSummaries structure:");
            console.log(`  Type: ${typeof decision.titlesAndSummaries}`);
            console.log(`  Value: ${JSON.stringify(decision.titlesAndSummaries, null, 2)}`);
            console.log("");
          }

          // Extract text from titlesAndSummaries
          const extracted = extractTextFromTitlesAndSummaries(decision.titlesAndSummaries);

          // Build text for embedding - handle missing fields gracefully
          const parts = [
            decision.jurisdiction && `Juridiction: ${decision.jurisdiction}`,
            decision.chamber && `Chambre: ${decision.chamber}`,
            decision.decision_date && `Date: ${decision.decision_date}`,
            decision.solution && `Solution: ${decision.solution}`,
            decision.type && `Type: ${decision.type}`,
            extracted.summary && `Résumé: ${extracted.summary}`,
            extracted.content && `Contenu: ${extracted.content}`,
          ].filter(Boolean);

          const textToEmbed = parts.join("\n").trim();

          if (!textToEmbed) {
            console.log(`${progress} ⚠️  Skipping ${decisionIdentifier} - no content to embed`);
            processedCount++;
            continue;
          }

          // Generate embedding with retry on rate limit
          const embedding = await generateEmbeddingWithRetry(textToEmbed);

          // Check if decision already exists
          const { data: existing } = await supabase
            .from("court_decisions")
            .select("id")
            .eq("case_number", decision.number || decision.id)
            .single();

          const isUpdate = !!existing;

          // Upsert into database (insert or update if exists)
          const decisionData = {
            jurisdiction: decision.jurisdiction || null,
            chambre: decision.chamber || null,
            date_decision: decision.decision_date || null,
            case_number: decision.number || null,
            ecli: decision.ecli || null,
            title: extracted.title || (decision.number ? `Décision n°${decision.number}` : `Décision ${decision.id}`),
            summary: extracted.summary || null,
            content: extracted.content || null,
            source_url: `https://www.courdecassation.fr/decision/${decision.id}`,
            embedding: embedding,
          };

          const { error } = await supabase
            .from("court_decisions")
            .upsert(decisionData, { onConflict: "case_number" });

          if (error) {
            // Log more details about database errors
            console.error(`${progress} ❌ Database error for ${decisionIdentifier}:`);
            console.error(`  Code: ${error.code}`);
            console.error(`  Message: ${error.message}`);
            if (error.details) console.error(`  Details: ${error.details}`);
            throw error;
          }

          if (isUpdate) {
            console.log(`${progress} 🔄 Updated ${decisionIdentifier}`);
            updatedCount++;
          } else {
            console.log(`${progress} ✅ Imported ${decisionIdentifier} (new)`);
            newCount++;
          }
          successCount++;
        } catch (error) {
          const decisionIdentifier = decision?.number || decision?.id || "unknown";
          console.error(`${progress} ❌ Error importing ${decisionIdentifier}:`);
          if (error instanceof Error) {
            console.error(`  ${error.message}`);
          } else {
            console.error(`  ${error}`);
          }
          errorCount++;
        }

        processedCount++;

        // Rate limiting: pause between requests
        if (processedCount < MAX_DECISIONS) {
          await sleep(RATE_LIMIT_DELAY);
        }
      }

      currentPage++;

      // Small delay between pages
      await sleep(RATE_LIMIT_DELAY);
    } catch (error) {
      console.error(`Error fetching page ${currentPage}:`, error);
      errorCount++;
      currentPage++;

      // Continue to next page on error
      await sleep(RATE_LIMIT_DELAY);
    }
  }

  console.log("\n--- Import Complete ---");
  console.log(`✅ Total success: ${successCount}`);
  console.log(`   ├─ 🆕 New: ${newCount}`);
  console.log(`   └─ 🔄 Updated: ${updatedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📊 Total processed: ${processedCount}`);
  console.log(`\n💾 Total in database: ~${existingDecisions + newCount} decisions`);
}

main().catch(console.error);
