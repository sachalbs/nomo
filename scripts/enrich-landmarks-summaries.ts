/**
 * Enrich Landmarks Summaries
 *
 * Ce script enrichit les summaries des arrêts landmarks avec des mots-clés
 * juridiques pertinents et regénère leurs embeddings pour améliorer le RAG.
 *
 * Usage: npx tsx scripts/enrich-landmarks-summaries.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

// ============================================================================
// CONFIGURATION
// ============================================================================

interface EnrichmentConfig {
  landmarkName: string;
  keywords: string[];
}

const enrichments: EnrichmentConfig[] = [
  {
    landmarkName: "Vilgrain",
    keywords: ["réticence dolosive", "dol", "obligation d'information", "vice du consentement"]
  },
  {
    landmarkName: "Fragonard",
    keywords: ["erreur sur la substance", "authenticité œuvre d'art", "erreur sur les qualités essentielles", "vice du consentement"]
  },
  {
    landmarkName: "Costedoat",
    keywords: ["responsabilité du fait d'autrui", "immunité préposé", "commettant", "faute du préposé"]
  },
  {
    landmarkName: "Bertrand",
    keywords: ["responsabilité parentale", "cohabitation", "enfant mineur", "responsabilité des parents"]
  },
  {
    landmarkName: "Labassée",
    keywords: ["GPA", "gestation pour autrui", "filiation", "mère porteuse", "transcription acte de naissance"]
  },
  {
    landmarkName: "Dépakine",
    keywords: ["produit défectueux", "médicament", "malformation", "responsabilité du fabricant", "défaut d'information"]
  },
  {
    landmarkName: "PIP",
    keywords: ["produit défectueux", "implants mammaires", "prothèses", "responsabilité du fabricant"]
  },
  {
    landmarkName: "Coca-Cola",
    keywords: ["rupture brutale", "relations commerciales", "préavis", "L.442-1 Code de commerce"]
  }
];

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(70));
  console.log("     ENRICHISSEMENT DES SUMMARIES - LANDMARKS");
  console.log("=".repeat(70));
  console.log("\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error("Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  let successCount = 0;
  let errorCount = 0;

  for (const config of enrichments) {
    console.log(`\n[${config.landmarkName}]`);
    console.log(`   Mots-clés: ${config.keywords.join(", ")}`);

    // Find the landmark by name (case-insensitive search)
    const { data: landmarks, error: searchError } = await supabase
      .from("court_decisions")
      .select("landmark_name, title, summary, case_number")
      .eq("is_landmark", true)
      .ilike("landmark_name", `%${config.landmarkName}%`);

    if (searchError) {
      console.error(`   Erreur recherche: ${searchError.message}`);
      errorCount++;
      continue;
    }

    if (!landmarks || landmarks.length === 0) {
      // Try searching in title
      const { data: byTitle, error: titleError } = await supabase
        .from("court_decisions")
        .select("landmark_name, title, summary, case_number")
        .eq("is_landmark", true)
        .ilike("title", `%${config.landmarkName}%`);

      if (titleError || !byTitle || byTitle.length === 0) {
        console.error(`   Arrêt non trouvé dans la base`);
        errorCount++;
        continue;
      }

      landmarks.push(...byTitle);
    }

    const landmark = landmarks[0];
    console.log(`   Trouvé: ${landmark.landmark_name || landmark.title}`);
    console.log(`   Case number: ${landmark.case_number || 'N/A'}`);

    // Build enriched summary
    const currentSummary = landmark.summary || "";
    const keywordsSection = `\n\nMots-clés juridiques: ${config.keywords.join(", ")}.`;

    // Check if keywords are already in summary
    const hasKeywords = config.keywords.some(kw =>
      currentSummary.toLowerCase().includes(kw.toLowerCase())
    );

    let newSummary: string;
    if (hasKeywords) {
      // Just add missing keywords
      const missingKeywords = config.keywords.filter(kw =>
        !currentSummary.toLowerCase().includes(kw.toLowerCase())
      );
      if (missingKeywords.length === 0) {
        console.log(`   Summary déjà enrichi, régénération embedding uniquement`);
        newSummary = currentSummary;
      } else {
        newSummary = currentSummary + `\n\nMots-clés additionnels: ${missingKeywords.join(", ")}.`;
      }
    } else {
      newSummary = currentSummary + keywordsSection;
    }

    // Generate new embedding
    console.log(`   Génération embedding...`);
    const textForEmbedding = `${landmark.title || ""} ${newSummary}`;

    try {
      const embedding = await generateEmbedding(textForEmbedding);
      console.log(`   Embedding généré (${embedding.length} dimensions)`);

      // Update in database using landmark_name as identifier
      const { error: updateError } = await supabase
        .from("court_decisions")
        .update({
          summary: newSummary,
          embedding: embedding
        })
        .eq("is_landmark", true)
        .eq("landmark_name", landmark.landmark_name);

      if (updateError) {
        console.error(`   Erreur update: ${updateError.message}`);
        errorCount++;
        continue;
      }

      console.log(`   Mise à jour réussie`);
      successCount++;

    } catch (embeddingError) {
      const msg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
      console.error(`   Erreur embedding: ${msg}`);
      errorCount++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("                         RÉSUMÉ");
  console.log("=".repeat(70));
  console.log(`\n   Arrêts enrichis: ${successCount}/${enrichments.length}`);
  console.log(`   Erreurs: ${errorCount}`);
  console.log("\n" + "=".repeat(70) + "\n");

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
