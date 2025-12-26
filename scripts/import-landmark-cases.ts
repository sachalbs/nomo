/**
 * Import des grands arrets incontournables dans Supabase
 *
 * Usage: npx tsx scripts/import-landmark-cases.ts
 *
 * PREREQUIS:
 * 1. Executer d'abord le SQL pour ajouter la colonne is_landmark:
 *    ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS is_landmark BOOLEAN DEFAULT FALSE;
 *    ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS landmark_name TEXT;
 *    CREATE INDEX IF NOT EXISTS idx_court_decisions_landmark ON court_decisions(is_landmark) WHERE is_landmark = true;
 *
 * 2. Variables d'environnement requises:
 *    - NEXT_PUBLIC_SUPABASE_URL
 *    - NEXT_PUBLIC_SUPABASE_ANON_KEY (ou SUPABASE_SERVICE_ROLE_KEY)
 *    - MISTRAL_API_KEY
 *    - PISTE_CLIENT_ID
 *    - PISTE_CLIENT_SECRET
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

// ============================================================================
// CONFIGURATION
// ============================================================================

const PISTE_AUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const JUDILIBRE_API_URL = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";
const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests
const MAX_RETRIES = 3;

// ============================================================================
// LISTE DES GRANDS ARRETS
// ============================================================================

interface LandmarkCase {
  name: string;
  date: string;
  jurisdiction: string;
  chamber?: string;
  pourvoi?: string;
  themes: string[];
  description?: string;
}

const LANDMARK_CASES: LandmarkCase[] = [
  // ==================== DROIT CIVIL - RESPONSABILITE ====================
  {
    name: "Jand'heur",
    date: "1930-02-13",
    jurisdiction: "Cour de cassation",
    chamber: "Chambres reunies",
    themes: ["responsabilite", "fait des choses", "presomption"],
    description: "Principe general de responsabilite du fait des choses",
  },
  {
    name: "Franck",
    date: "1941-12-02",
    jurisdiction: "Cour de cassation",
    chamber: "Chambres reunies",
    themes: ["responsabilite", "fait des choses", "garde"],
    description: "Notion de garde de la chose",
  },
  {
    name: "Desmares",
    date: "1982-07-21",
    jurisdiction: "Cour de cassation",
    chamber: "Deuxieme chambre civile",
    themes: ["responsabilite", "fait des choses", "faute victime"],
    description: "Faute de la victime et exoneration",
  },
  {
    name: "Lemaire",
    date: "1984-05-09",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    themes: ["responsabilite", "fait des choses", "acceptation risques"],
    description: "Acceptation des risques",
  },
  {
    name: "Gabillet",
    date: "1984-05-09",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    themes: ["responsabilite", "fait d'autrui", "enfant"],
    description: "Responsabilite des parents du fait de leur enfant",
  },
  {
    name: "Fullenwarth",
    date: "1984-05-09",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    themes: ["responsabilite", "fait d'autrui", "enfant", "discernement"],
    description: "Responsabilite sans faute de l'enfant",
  },
  {
    name: "Blieck",
    date: "1991-03-29",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "89-15.231",
    themes: ["responsabilite", "fait d'autrui", "principe general"],
    description: "Principe general de responsabilite du fait d'autrui",
  },
  {
    name: "Bertrand",
    date: "1997-02-19",
    jurisdiction: "Cour de cassation",
    chamber: "Deuxieme chambre civile",
    themes: ["responsabilite", "fait d'autrui", "associations sportives"],
    description: "Responsabilite des associations sportives",
  },
  {
    name: "Levert",
    date: "2001-02-08",
    jurisdiction: "Cour de cassation",
    chamber: "Deuxieme chambre civile",
    themes: ["responsabilite", "fait d'autrui", "associations"],
    description: "Responsabilite des associations pour leurs membres",
  },
  {
    name: "Costedoat",
    date: "2000-02-25",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "97-17.378",
    themes: ["responsabilite", "fait d'autrui", "prepose", "immunite"],
    description: "Immunite du prepose agissant dans les limites de sa mission",
  },
  {
    name: "Perruche",
    date: "2000-11-17",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "99-13.701",
    themes: ["responsabilite", "prejudice", "naissance", "handicap"],
    description: "Prejudice de l'enfant ne handicape",
  },
  {
    name: "Erika",
    date: "2012-09-25",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre criminelle",
    pourvoi: "10-82.938",
    themes: ["responsabilite", "environnement", "prejudice ecologique"],
    description: "Reconnaissance du prejudice ecologique",
  },

  // ==================== DROIT DES CONTRATS ====================
  {
    name: "Canal de Craponne",
    date: "1876-03-06",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre civile",
    themes: ["contrat", "imprevision", "force obligatoire"],
    description: "Rejet de la theorie de l'imprevision",
  },
  {
    name: "Chronopost",
    date: "1996-10-22",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre commerciale",
    pourvoi: "93-18.632",
    themes: ["contrat", "clause limitative", "obligation essentielle"],
    description: "Clause limitative contredisant l'obligation essentielle",
  },
  {
    name: "Baldus",
    date: "2000-05-03",
    jurisdiction: "Cour de cassation",
    chamber: "Premiere chambre civile",
    pourvoi: "98-11.381",
    themes: ["contrat", "erreur", "authenticite", "oeuvre d'art"],
    description: "Erreur sur l'authenticite d'une oeuvre",
  },
  {
    name: "Poussin",
    date: "1978-02-22",
    jurisdiction: "Cour de cassation",
    chamber: "Premiere chambre civile",
    themes: ["contrat", "erreur", "substance", "oeuvre d'art"],
    description: "Erreur sur la substance - attribution d'un tableau",
  },
  {
    name: "Fragonard",
    date: "1987-03-24",
    jurisdiction: "Cour de cassation",
    chamber: "Premiere chambre civile",
    themes: ["contrat", "erreur", "alea", "oeuvre d'art"],
    description: "Erreur et alea dans la vente d'art",
  },
  {
    name: "Huard",
    date: "1992-11-03",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre commerciale",
    pourvoi: "90-18.547",
    themes: ["contrat", "bonne foi", "execution"],
    description: "Obligation de bonne foi dans l'execution du contrat",
  },
  {
    name: "Manoukian",
    date: "2003-01-26",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre commerciale",
    pourvoi: "00-10.243",
    themes: ["contrat", "rupture", "negociations", "bonne foi"],
    description: "Rupture abusive des negociations precontractuelles",
  },
  {
    name: "Boot Shop",
    date: "2006-10-06",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "05-13.255",
    themes: ["contrat", "tiers", "opposabilite", "effet relatif"],
    description: "Opposabilite du contrat aux tiers",
  },
  {
    name: "Faurecia II",
    date: "2010-06-29",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre commerciale",
    pourvoi: "09-11.841",
    themes: ["contrat", "clause limitative", "faute lourde"],
    description: "Clause limitative et faute lourde",
  },
  {
    name: "Besse",
    date: "1991-12-12",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "90-19.120",
    themes: ["contrat", "chaines de contrats", "action directe"],
    description: "Action directe dans les chaines de contrats",
  },

  // ==================== DROIT ADMINISTRATIF ====================
  {
    name: "Blanco",
    date: "1873-02-08",
    jurisdiction: "Tribunal des conflits",
    themes: ["administratif", "responsabilite", "competence", "service public"],
    description: "Naissance du droit administratif - competence administrative",
  },
  {
    name: "Terrier",
    date: "1903-02-06",
    jurisdiction: "Conseil d'Etat",
    themes: ["administratif", "contrat", "service public"],
    description: "Contrat administratif et service public",
  },
  {
    name: "Benjamin",
    date: "1933-05-19",
    jurisdiction: "Conseil d'Etat",
    themes: ["administratif", "police", "libertes", "proportionnalite"],
    description: "Controle de proportionnalite des mesures de police",
  },
  {
    name: "Dehaene",
    date: "1950-07-07",
    jurisdiction: "Conseil d'Etat",
    themes: ["administratif", "greve", "fonctionnaires", "service public"],
    description: "Droit de greve des fonctionnaires",
  },
  {
    name: "Dame Lamotte",
    date: "1950-02-17",
    jurisdiction: "Conseil d'Etat",
    themes: ["administratif", "recours", "exces de pouvoir", "droit fondamental"],
    description: "Recours pour exces de pouvoir - principe general du droit",
  },
  {
    name: "Barel",
    date: "1954-05-28",
    jurisdiction: "Conseil d'Etat",
    themes: ["administratif", "concours", "discrimination", "opinions"],
    description: "Non-discrimination fondee sur les opinions politiques",
  },
  {
    name: "Jacques Vabre",
    date: "1975-05-24",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre mixte",
    themes: ["droit europeen", "primaute", "traite", "loi"],
    description: "Primaute du droit communautaire sur la loi",
  },
  {
    name: "Nicolo",
    date: "1989-10-20",
    jurisdiction: "Conseil d'Etat",
    chamber: "Assemblee",
    themes: ["administratif", "droit europeen", "primaute", "traite"],
    description: "Primaute du droit europeen - revirement du Conseil d'Etat",
  },
  {
    name: "Morsang-sur-Orge",
    date: "1995-10-27",
    jurisdiction: "Conseil d'Etat",
    chamber: "Assemblee",
    themes: ["administratif", "dignite humaine", "ordre public", "police"],
    description: "Dignite humaine composante de l'ordre public",
  },
  {
    name: "KPMG",
    date: "2006-03-24",
    jurisdiction: "Conseil d'Etat",
    chamber: "Assemblee",
    themes: ["administratif", "securite juridique", "confiance legitime"],
    description: "Principe de securite juridique",
  },
  {
    name: "Danthony",
    date: "2011-12-23",
    jurisdiction: "Conseil d'Etat",
    chamber: "Assemblee",
    themes: ["administratif", "procedure", "vice de forme", "annulation"],
    description: "Vice de procedure et annulation de l'acte",
  },
  {
    name: "Czabaj",
    date: "2016-07-13",
    jurisdiction: "Conseil d'Etat",
    chamber: "Assemblee",
    themes: ["administratif", "delai", "recours", "securite juridique"],
    description: "Delai raisonnable pour contester une decision",
  },

  // ==================== DROIT CONSTITUTIONNEL ====================
  {
    name: "Liberte d'association",
    date: "1971-07-16",
    jurisdiction: "Conseil constitutionnel",
    pourvoi: "71-44 DC",
    themes: ["constitutionnel", "libertes", "PFRLR", "bloc de constitutionnalite"],
    description: "Valeur constitutionnelle du Preambule de 1946",
  },
  {
    name: "IVG",
    date: "1975-01-15",
    jurisdiction: "Conseil constitutionnel",
    pourvoi: "74-54 DC",
    themes: ["constitutionnel", "traite", "loi", "controle"],
    description: "Distinction controle de constitutionnalite et de conventionnalite",
  },
  {
    name: "Mariage pour tous",
    date: "2013-05-17",
    jurisdiction: "Conseil constitutionnel",
    pourvoi: "2013-669 DC",
    themes: ["constitutionnel", "mariage", "egalite", "famille"],
    description: "Constitutionnalite du mariage entre personnes de meme sexe",
  },

  // ==================== AUTRES GRANDS ARRETS ====================
  {
    name: "Mercier",
    date: "1936-05-20",
    jurisdiction: "Cour de cassation",
    chamber: "Chambre civile",
    themes: ["contrat", "medical", "obligation", "moyens"],
    description: "Nature contractuelle de la relation medecin-patient",
  },
  {
    name: "Consorts Cruz",
    date: "2002-03-28",
    jurisdiction: "Cour de cassation",
    chamber: "Assemblee pleniere",
    pourvoi: "00-11.914",
    themes: ["responsabilite", "alea therapeutique", "faute"],
    description: "Alea therapeutique et responsabilite medicale",
  },
  {
    name: "Pelletier",
    date: "1873-07-30",
    jurisdiction: "Tribunal des conflits",
    themes: ["administratif", "faute personnelle", "faute de service"],
    description: "Distinction faute personnelle et faute de service",
  },
];

// ============================================================================
// UTILITAIRES
// ============================================================================

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE credentials (PISTE_CLIENT_ID, PISTE_CLIENT_SECRET)");
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

  const data = await response.json();
  return data.access_token;
}

async function searchJudilibre(
  accessToken: string,
  query: string,
  dateStart?: string,
  dateEnd?: string
): Promise<any[]> {
  const params: Record<string, string> = {
    query,
    page: "0",
    page_size: "10",
  };

  if (dateStart) params.date_start = dateStart;
  if (dateEnd) params.date_end = dateEnd;

  const url = `${JUDILIBRE_API_URL}/search?${new URLSearchParams(params)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Judilibre search error: ${error}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function getDecisionDetails(accessToken: string, decisionId: string): Promise<any> {
  const url = `${JUDILIBRE_API_URL}/decision?id=${decisionId}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Judilibre decision error: ${error}`);
  }

  return await response.json();
}

function extractTextFromDecision(decision: any): string {
  const parts: string[] = [];

  if (decision.jurisdiction) parts.push(`Juridiction: ${decision.jurisdiction}`);
  if (decision.chamber) parts.push(`Chambre: ${decision.chamber}`);
  if (decision.decision_date) parts.push(`Date: ${decision.decision_date}`);
  if (decision.number) parts.push(`Numero: ${decision.number}`);
  if (decision.solution) parts.push(`Solution: ${decision.solution}`);

  // Handle titlesAndSummaries
  const ts = decision.titlesAndSummaries;
  if (ts) {
    if (typeof ts === "string") {
      parts.push(`Resume: ${ts}`);
    } else if (Array.isArray(ts)) {
      parts.push(`Resume: ${ts.join("\n")}`);
    } else if (typeof ts === "object") {
      const summary = ts.summary || ts.sommaire || ts.resume || "";
      if (summary) parts.push(`Resume: ${summary}`);
    }
  }

  return parts.join("\n").trim();
}

async function generateEmbeddingWithRetry(text: string): Promise<number[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`  ⚠️  Embedding error (attempt ${attempt}/${MAX_RETRIES}): ${errorMsg}`);

      if (attempt < MAX_RETRIES) {
        await sleep(5000);
      } else {
        throw error;
      }
    }
  }
  throw new Error("Failed to generate embedding");
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(65));
  console.log("        IMPORT DES GRANDS ARRETS INCONTOURNABLES");
  console.log("=".repeat(65));
  console.log("\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
  }

  if (!mistralKey) {
    console.error("❌ Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if is_landmark column exists
  console.log("📋 Checking database schema...");
  const { data: testData, error: testError } = await supabase
    .from("court_decisions")
    .select("id, is_landmark, landmark_name")
    .limit(1);

  if (testError && testError.message.includes("is_landmark")) {
    console.log("\n⚠️  La colonne 'is_landmark' n'existe pas.");
    console.log("   Executez d'abord ce SQL dans Supabase:");
    console.log("\n   ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS is_landmark BOOLEAN DEFAULT FALSE;");
    console.log("   ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS landmark_name TEXT;");
    console.log("   CREATE INDEX IF NOT EXISTS idx_court_decisions_landmark ON court_decisions(is_landmark) WHERE is_landmark = true;\n");
    process.exit(1);
  }

  // Get Judilibre access token
  console.log("🔐 Authentification PISTE/Judilibre...");
  let accessToken: string | null = null;
  try {
    accessToken = await getAccessToken();
    console.log("✅ Authentification reussie\n");
  } catch (error) {
    console.log("⚠️  Pas d'acces a Judilibre - import manuel uniquement\n");
  }

  // Check existing landmarks
  const { data: existingLandmarks, error: landmarkError } = await supabase
    .from("court_decisions")
    .select("landmark_name, case_number")
    .eq("is_landmark", true);

  const existingNames = new Set(
    (existingLandmarks || []).map((l) => l.landmark_name?.toLowerCase())
  );
  const existingPourvois = new Set(
    (existingLandmarks || []).map((l) => l.case_number?.toLowerCase())
  );

  console.log(`📊 ${existingLandmarks?.length || 0} grands arrets deja en base\n`);

  // Process each landmark case
  let imported = 0;
  let skipped = 0;
  let notFound = 0;
  const notFoundList: string[] = [];

  console.log(`🔍 Traitement de ${LANDMARK_CASES.length} grands arrets...\n`);
  console.log("-".repeat(65));

  for (let i = 0; i < LANDMARK_CASES.length; i++) {
    const landmark = LANDMARK_CASES[i];
    const progress = `[${i + 1}/${LANDMARK_CASES.length}]`;

    // Check if already exists
    if (existingNames.has(landmark.name.toLowerCase())) {
      console.log(`${progress} ⏭️  ${landmark.name} - deja en base`);
      skipped++;
      continue;
    }

    if (landmark.pourvoi && existingPourvois.has(landmark.pourvoi.toLowerCase())) {
      console.log(`${progress} ⏭️  ${landmark.name} (${landmark.pourvoi}) - deja en base`);
      skipped++;
      continue;
    }

    console.log(`${progress} 🔍 ${landmark.name}...`);

    let decisionData: any = null;
    let decisionText = "";

    // Try to find in Judilibre
    if (accessToken && landmark.jurisdiction === "Cour de cassation") {
      try {
        // Search by pourvoi number if available
        let results: any[] = [];
        if (landmark.pourvoi) {
          results = await searchJudilibre(accessToken, landmark.pourvoi);
        }

        // If not found, search by name and date
        if (results.length === 0) {
          const dateStart = landmark.date;
          const dateEnd = landmark.date;
          results = await searchJudilibre(accessToken, landmark.name, dateStart, dateEnd);
        }

        if (results.length > 0) {
          // Get full decision details
          const details = await getDecisionDetails(accessToken, results[0].id);
          decisionText = extractTextFromDecision(details);

          decisionData = {
            jurisdiction: details.jurisdiction || landmark.jurisdiction,
            chambre: details.chamber || landmark.chamber,
            date_decision: details.decision_date || landmark.date,
            case_number: details.number || landmark.pourvoi,
            ecli: details.ecli,
            title: `Arret ${landmark.name}`,
            summary: decisionText.substring(0, 500),
            content: decisionText,
            source_url: `https://www.courdecassation.fr/decision/${details.id}`,
          };

          console.log(`  ✅ Trouve dans Judilibre`);
        }

        await sleep(RATE_LIMIT_DELAY);
      } catch (error) {
        console.log(`  ⚠️  Erreur Judilibre: ${error instanceof Error ? error.message : error}`);
      }
    }

    // If not found in Judilibre, create manual entry
    if (!decisionData) {
      console.log(`  📝 Creation manuelle...`);

      decisionText = [
        `Arret ${landmark.name}`,
        `Juridiction: ${landmark.jurisdiction}`,
        landmark.chamber && `Chambre: ${landmark.chamber}`,
        `Date: ${landmark.date}`,
        landmark.pourvoi && `Pourvoi: ${landmark.pourvoi}`,
        `Themes: ${landmark.themes.join(", ")}`,
        landmark.description && `Description: ${landmark.description}`,
      ]
        .filter(Boolean)
        .join("\n");

      decisionData = {
        jurisdiction: landmark.jurisdiction,
        chambre: landmark.chamber || null,
        date_decision: landmark.date,
        case_number: landmark.pourvoi || `${landmark.name}-${landmark.date}`,
        title: `Arret ${landmark.name}`,
        summary: landmark.description || `Grand arret: ${landmark.name}`,
        content: decisionText,
        source_url: null, // No URL for manual entries
      };

      notFound++;
      notFoundList.push(landmark.name);
    }

    // Generate embedding
    try {
      console.log(`  🧠 Generation embedding...`);
      const embedding = await generateEmbeddingWithRetry(decisionText);
      decisionData.embedding = embedding;
    } catch (error) {
      console.log(`  ❌ Erreur embedding: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    // Add landmark flags
    decisionData.is_landmark = true;
    decisionData.landmark_name = landmark.name;

    // Insert into database
    const { error: insertError } = await supabase
      .from("court_decisions")
      .upsert(decisionData, { onConflict: "case_number" });

    if (insertError) {
      console.log(`  ❌ Erreur insertion: ${insertError.message}`);
    } else {
      console.log(`  ✅ Importe avec succes`);
      imported++;
    }

    // Rate limiting
    await sleep(500);
  }

  // Summary
  console.log("\n");
  console.log("=".repeat(65));
  console.log("                      RESUME");
  console.log("=".repeat(65));
  console.log("\n");

  console.log(`   ✅ Importes:     ${imported}`);
  console.log(`   ⏭️  Deja en base: ${skipped}`);
  console.log(`   📝 Manuels:      ${notFound}`);
  console.log(`   📊 Total:        ${LANDMARK_CASES.length}`);

  if (notFoundList.length > 0) {
    console.log("\n   ⚠️  Arrets non trouves dans Judilibre (entrees manuelles):");
    notFoundList.forEach((name) => console.log(`      - ${name}`));
  }

  console.log("\n");
  console.log("=".repeat(65));
  console.log("\n");
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
