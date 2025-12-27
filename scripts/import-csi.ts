// @ts-nocheck
/**
 * Import Code de la Sécurité Intérieure (CSI) from Légifrance/PISTE API
 *
 * Usage: npx tsx scripts/import-csi.ts [--resume] [--limit N]
 *
 * Options:
 *   --resume  Skip already imported articles
 *   --limit N Only import N articles (for testing)
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CSI_ID = "LEGITEXT000025503132";
const CSI_NAME = "Code de la sécurité intérieure";

const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const API_BASE_URL = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";
const MISTRAL_API_URL = "https://api.mistral.ai/v1/embeddings";

const RATE_LIMIT_DELAY = 1500; // 1.5s between API requests
const EMBEDDING_DELAY = 500; // 0.5s between embedding requests
const BATCH_SIZE = 20; // Log progress every N articles

// ============================================================================
// TYPES
// ============================================================================

interface OAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface TableMatieresSection {
  id: string;
  cid: string;
  title: string;
  etat: string;
  articles?: TableMatieresArticle[];
  sections?: TableMatieresSection[];
}

interface TableMatieresArticle {
  id: string;
  cid: string;
  num: string;
  etat: string;
}

interface ArticleResponse {
  article: {
    id: string;
    cid: string;
    num: string;
    texte: string;
    texteHtml: string;
    etat: string;
    nota: string | null;
  };
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLegifranceUrl(articleId: string): string {
  return `https://www.legifrance.gouv.fr/codes/article_lc/${articleId}`;
}

// ============================================================================
// PISTE/LEGIFRANCE API
// ============================================================================

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
  }

  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid",
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth error: ${response.status} - ${await response.text()}`);
  }

  const data: OAuthToken = await response.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function apiRequest<T>(endpoint: string, body?: object): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${await response.text()}`);
  }

  return response.json();
}

async function getTableMatieres(): Promise<{ sections: TableMatieresSection[] }> {
  return apiRequest("/consult/code/tableMatieres", {
    textId: CSI_ID,
    date: new Date().toISOString().split("T")[0],
  });
}

async function getArticle(articleId: string): Promise<ArticleResponse> {
  return apiRequest("/consult/getArticle", { id: articleId });
}

function extractArticleIds(sections: TableMatieresSection[]): { id: string; num: string }[] {
  const articles: { id: string; num: string }[] = [];

  function traverse(section: TableMatieresSection) {
    if (section.articles) {
      for (const article of section.articles) {
        if (article.etat === "VIGUEUR") {
          articles.push({ id: article.id, num: article.num });
        }
      }
    }
    if (section.sections) {
      for (const sub of section.sections) {
        traverse(sub);
      }
    }
  }

  for (const section of sections) {
    traverse(section);
  }

  return articles;
}

// ============================================================================
// MISTRAL EMBEDDINGS
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error("Missing MISTRAL_API_KEY");
  }

  // Truncate text if too long (Mistral has token limits)
  const truncated = text.slice(0, 8000);

  const response = await fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "mistral-embed",
      input: [truncated],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("429") && i < maxRetries - 1) {
        const wait = 2000 * (i + 1);
        console.log(`   Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Max retries exceeded");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(65));
  console.log("     IMPORT CODE DE LA SÉCURITÉ INTÉRIEURE (CSI)");
  console.log("=".repeat(65));
  console.log("\n");

  // Parse args
  const args = process.argv.slice(2);
  const shouldResume = args.includes("--resume");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : null;

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error("❌ Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  if (!process.env.PISTE_CLIENT_ID || !process.env.PISTE_CLIENT_SECRET) {
    console.error("❌ Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Step 1: Get table des matières
  console.log("📋 Récupération de la table des matières...");
  let tableDesMatieres;
  try {
    tableDesMatieres = await getTableMatieres();
    console.log("   ✅ Table des matières récupérée\n");
  } catch (error) {
    console.error("❌ Erreur:", error);
    process.exit(1);
  }

  // Step 2: Extract article IDs
  console.log("📑 Extraction des articles en vigueur...");
  const allArticles = extractArticleIds(tableDesMatieres.sections);
  console.log(`   📊 ${allArticles.length} articles trouvés\n`);

  // Step 3: Check existing articles if resuming
  let articlesToImport = allArticles;

  if (shouldResume) {
    console.log("🔍 Vérification des articles existants...");
    const { data: existing } = await supabase
      .from("law_articles")
      .select("article_number")
      .eq("code_name", CSI_NAME);

    const existingSet = new Set(existing?.map((a) => a.article_number) || []);
    console.log(`   📦 ${existingSet.size} articles déjà importés`);

    articlesToImport = allArticles.filter((a) => !existingSet.has(`Article ${a.num}`));
    console.log(`   📝 ${articlesToImport.length} articles restants à importer\n`);
  }

  // Apply limit if specified
  if (limit && limit > 0) {
    articlesToImport = articlesToImport.slice(0, limit);
    console.log(`   ⚠️  Limite appliquée: ${limit} articles\n`);
  }

  if (articlesToImport.length === 0) {
    console.log("✅ Tous les articles sont déjà importés !");
    return;
  }

  // Step 4: Import articles
  console.log("🚀 Début de l'import...\n");
  console.log("-".repeat(65));

  let successCount = 0;
  let errorCount = 0;
  const errors: { num: string; error: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < articlesToImport.length; i++) {
    const { id, num } = articlesToImport[i];
    const progress = `[${i + 1}/${articlesToImport.length}]`;

    try {
      process.stdout.write(`${progress} Article ${num}...`);

      // Fetch article content
      await sleep(RATE_LIMIT_DELAY);
      const articleData = await getArticle(id);
      const article = articleData.article;

      // Clean content
      const content = cleanHtml(article.texteHtml || article.texte);

      if (!content || content.length < 10) {
        console.log(" ⏭️  Contenu vide, ignoré");
        continue;
      }

      // Generate embedding
      await sleep(EMBEDDING_DELAY);
      const embedding = await generateEmbeddingWithRetry(content);

      // Insert into Supabase
      const { error: insertError } = await supabase.from("law_articles").insert({
        code_name: CSI_NAME,
        article_number: `Article ${num}`,
        title: null,
        content: content,
        legifrance_url: buildLegifranceUrl(id),
        source_url: buildLegifranceUrl(id),
        embedding: embedding,
      });

      if (insertError) {
        throw new Error(insertError.message);
      }

      console.log(` ✅ (${content.length} chars)`);
      successCount++;

      // Progress report every BATCH_SIZE articles
      if ((i + 1) % BATCH_SIZE === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = successCount / elapsed;
        const remaining = articlesToImport.length - i - 1;
        const eta = remaining / rate / 60;
        console.log(`\n   📊 Progression: ${successCount} importés, ${errorCount} erreurs`);
        console.log(`   ⏱️  Temps écoulé: ${Math.round(elapsed / 60)}min, ETA: ${Math.round(eta)}min\n`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(` ❌ ${errorMsg.slice(0, 50)}`);
      errors.push({ num, error: errorMsg });
      errorCount++;
    }
  }

  // Summary
  console.log("\n");
  console.log("=".repeat(65));
  console.log("                      RÉSUMÉ");
  console.log("=".repeat(65));
  console.log("\n");

  const totalTime = (Date.now() - startTime) / 1000 / 60;
  console.log(`   ✅ Importés:     ${successCount}`);
  console.log(`   ❌ Erreurs:      ${errorCount}`);
  console.log(`   ⏱️  Durée totale: ${Math.round(totalTime)} minutes`);

  if (errors.length > 0 && errors.length <= 20) {
    console.log("\n   Erreurs détaillées:");
    errors.forEach((e) => {
      console.log(`     - Article ${e.num}: ${e.error.slice(0, 60)}`);
    });
  }

  console.log("\n");
  console.log("=".repeat(65));
  console.log("\n");
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
