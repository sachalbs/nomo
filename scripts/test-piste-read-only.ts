// @ts-nocheck
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  getTableMatieres,
  extractArticleIds,
} from "../lib/legifrance-api";

const CODE_ID = "LEGITEXT000006071154";
const CODE_NAME = "Code de procédure pénale";

async function main() {
  console.log("=== Test API PISTE - Lecture seule ===\n");
  console.log(`Code ID: ${CODE_ID}`);
  console.log(`Code Name: ${CODE_NAME}\n`);

  // Step 1: Authenticate and fetch table des matières
  console.log("1. Authentification OAuth PISTE et récupération de la table des matières...");

  let tableDesMatieres;
  let articleRefs;

  try {
    tableDesMatieres = await getTableMatieres(CODE_ID);
    console.log("   ✓ Authentification réussie");
    console.log("   ✓ Table des matières récupérée\n");

    // Step 2: Extract article IDs
    console.log("2. Extraction des IDs d'articles...");
    articleRefs = extractArticleIds(tableDesMatieres.sections);
    console.log(`   ✓ ${articleRefs.length} articles trouvés en vigueur\n`);

  } catch (error) {
    console.error("   ✗ Erreur lors de l'accès à l'API PISTE:", error);
    if (error instanceof Error) {
      console.error("   Message:", error.message);
      console.error("   Stack:", error.stack);
    }
    process.exit(1);
  }

  // Step 3: Display first 10 article IDs
  console.log("3. Les 10 premiers articles :");
  articleRefs.slice(0, 10).forEach((ref, i) => {
    console.log(`   ${i + 1}. Article ${ref.num} - ID: ${ref.id}`);
  });
  console.log("");

  // Step 4: Check Supabase count
  console.log("4. Vérification de la base de données Supabase...");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("   ✗ Variables d'environnement Supabase manquantes");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { count, error } = await supabase
      .from("law_articles")
      .select("*", { count: "exact", head: true })
      .eq("code_name", CODE_NAME);

    if (error) {
      console.error("   ✗ Erreur lors de la requête Supabase:", error);
    } else {
      console.log(`   ✓ Articles dans Supabase : ${count || 0}\n`);
    }

    // Summary
    console.log("=== RÉSUMÉ ===");
    console.log(`Articles disponibles dans l'API PISTE : ${articleRefs.length}`);
    console.log(`Articles dans la base Supabase : ${count || 0}`);
    console.log(`Articles manquants : ${articleRefs.length - (count || 0)}`);
    console.log(`Progression : ${(((count || 0) / articleRefs.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error("   ✗ Erreur Supabase:", error);
  }
}

main().catch((error) => {
  console.error("\n✗ Erreur fatale:", error);
  process.exit(1);
});
