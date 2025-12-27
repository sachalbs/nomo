/**
 * Import Landmark Cases from Judilibre API
 *
 * This script imports landmark jurisprudence from:
 * 1. Judilibre API via PISTE OAuth (for Cour de cassation decisions)
 * 2. Manual enriched data (fallback)
 *
 * Usage: npx tsx scripts/import-landmarks-judilibre.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// PISTE OAuth configuration
const PISTE_AUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const JUDILIBRE_API_URL = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";

// ============================================================================
// TYPES
// ============================================================================

interface JurisprudenceEntry {
  nom: string;
  date: string;
  juridiction: string;
  numero?: string;
  themes: string[];
  matiere: string;
}

interface JurisprudencesFile {
  jurisprudences: JurisprudenceEntry[];
}

interface JudilibreSearchResult {
  results: Array<{
    id: string;
    number: string;
    decision_date: string;
    chamber: string;
    jurisdiction: string;
    summary?: string;
  }>;
  total: number;
}

interface JudilibreDecision {
  id: string;
  number: string;
  decision_date: string;
  chamber: string;
  jurisdiction: string;
  text: string;
  summary?: string;
  solution?: string;
}

interface ImportResult {
  imported: Array<{ nom: string; numero?: string; source: string }>;
  not_found: Array<{ nom: string; numero?: string; reason: string }>;
  already_exists: Array<{ nom: string; numero?: string }>;
  errors: Array<{ nom: string; numero?: string; error: string }>;
}

// ============================================================================
// ENRICHED CONTENT (Fallback when Judilibre is not available)
// ============================================================================

const ENRICHED_CONTENT: Record<string, string> = {
  "Baldus": `Arrêt Baldus - Cour de cassation, 1ère chambre civile, 3 mai 2000, n°98-11.381

Faits : Un vendeur avait cédé des photographies de Baldus à un prix dérisoire, ignorant leur valeur artistique.

Solution : La Cour de cassation refuse d'annuler la vente pour erreur, considérant que l'acheteur n'avait pas d'obligation d'informer le vendeur de la valeur des biens.

Portée : Cet arrêt confirme l'absence de devoir général d'information de l'acheteur sur la valeur du bien. Il distingue la réticence dolosive (sanction du silence frauduleux) de la simple absence d'information sur la valeur.`,

  "Chronopost": `Arrêt Chronopost - Cour de cassation, Chambre commerciale, 22 octobre 1996, n°93-18.632

Faits : La société Chronopost avait livré en retard des plis contenant une soumission à un appel d'offres. La clause limitative de responsabilité du contrat limitait l'indemnisation au prix du transport.

Solution : La Cour de cassation juge que 'en raison du manquement à cette obligation essentielle, la clause limitative de responsabilité du contrat, qui contredisait la portée de l'engagement pris, devait être réputée non écrite'.

Portée : Arrêt fondateur posant qu'une clause limitative ne peut contredire l'obligation essentielle du contrat. Ce principe a été codifié à l'article 1170 du Code civil par la réforme de 2016.`,

  "Manoukian": `Arrêt Manoukian - Cour de cassation, Chambre commerciale, 26 novembre 2003, n°00-10.243

Faits : Des négociations avancées en vue de la cession d'une société avaient été brutalement rompues.

Solution : La Cour de cassation retient la responsabilité de celui qui rompt brutalement des négociations avancées, au mépris de la confiance légitime créée chez son partenaire.

Portée : Cet arrêt consacre le principe de la responsabilité pour rupture abusive des pourparlers, désormais codifié à l'article 1112 du Code civil.`,

  "Blieck": `Arrêt Blieck - Cour de cassation, Assemblée plénière, 29 mars 1991, n°89-15.231

Faits : Un handicapé mental, placé dans un centre d'aide par le travail (CAT), avait mis le feu à une forêt voisine.

Solution : L'Assemblée plénière affirme que l'article 1384 alinéa 1er (devenu 1242) pose un principe général de responsabilité du fait d'autrui applicable aux personnes ayant accepté la charge d'organiser et de contrôler, à titre permanent, le mode de vie d'autrui.

Portée : Cet arrêt majeur consacre un principe général de responsabilité du fait d'autrui au-delà des cas expressément prévus par la loi.`,

  "Costedoat": `Arrêt Costedoat - Cour de cassation, Assemblée plénière, 25 février 2000, n°97-17.378

Faits : Un préposé, pilote d'hélicoptère, avait causé des dommages en effectuant des épandages de produits phytosanitaires.

Solution : L'Assemblée plénière pose le principe que 'n'engage pas sa responsabilité à l'égard des tiers le préposé qui agit sans excéder les limites de la mission qui lui a été impartie par son commettant'.

Portée : Cet arrêt consacre l'immunité civile du préposé agissant dans le cadre de sa mission.`,

  "Perruche": `Arrêt Perruche - Cour de cassation, Assemblée plénière, 17 novembre 2000, n°99-13.701

Faits : Nicolas Perruche est né lourdement handicapé après que les médecins ont manqué le diagnostic de rubéole de sa mère, qui aurait avorté si elle avait été correctement informée.

Solution : L'Assemblée plénière reconnaît à l'enfant né handicapé le droit d'être indemnisé de son préjudice.

Portée : Arrêt très controversé admettant le préjudice de l'enfant du fait de sa naissance avec un handicap. Cette solution a été remise en cause par la loi anti-Perruche du 4 mars 2002.`,

  "Erika": `Arrêt Erika - Cour de cassation, Chambre criminelle, 25 septembre 2012, n°10-82.938

Faits : Le naufrage du pétrolier Erika en décembre 1999 a provoqué une marée noire catastrophique sur les côtes françaises.

Solution : La Chambre criminelle confirme la condamnation pour pollution maritime et reconnaît le préjudice écologique comme réparable.

Portée : Arrêt historique consacrant la réparation du préjudice écologique pur. Cette jurisprudence a été codifiée par la loi du 8 août 2016 (articles 1246 et suivants du Code civil).`,

  "Huard": `Arrêt Huard - Cour de cassation, Chambre commerciale, 3 novembre 1992, n°90-18.547

Faits : Un distributeur de carburant contestait le refus de son fournisseur de renégocier les conditions du contrat devenues déséquilibrées.

Solution : La Cour de cassation impose au contractant de mettre son partenaire en mesure de pratiquer un prix concurrentiel, au nom de l'exigence de bonne foi dans l'exécution du contrat.

Portée : Cet arrêt illustre le devoir de coopération entre contractants et l'obligation de renégociation fondée sur la bonne foi contractuelle (article 1104 du Code civil).`,

  "Boot Shop": `Arrêt Boot Shop - Cour de cassation, Assemblée plénière, 6 octobre 2006, n°05-13.255

Faits : Un tiers invoquait l'inexécution d'un contrat auquel il n'était pas partie pour fonder son action en responsabilité.

Solution : L'Assemblée plénière affirme que 'le tiers à un contrat peut invoquer, sur le fondement de la responsabilité délictuelle, un manquement contractuel dès lors que ce manquement lui a causé un dommage'.

Portée : Cet arrêt consacre l'opposabilité du contrat aux tiers et leur permet d'invoquer un manquement contractuel comme fondement de leur action délictuelle.`,

  "Faurecia II": `Arrêt Faurecia II - Cour de cassation, Chambre commerciale, 29 juin 2010, n°09-11.841

Faits : Un fournisseur informatique avait livré un logiciel défaillant. Sa responsabilité était limitée par une clause du contrat.

Solution : La Cour de cassation précise que la faute lourde fait obstacle à l'application d'une clause limitative de responsabilité.

Portée : Cet arrêt complète la jurisprudence Chronopost en précisant que la faute lourde neutralise les clauses limitatives.`,

  "Besse": `Arrêt Besse - Cour de cassation, Assemblée plénière, 12 juillet 1991, n°90-13.602

Faits : Un maître de l'ouvrage agissait contre un sous-traitant pour malfaçons.

Solution : L'Assemblée plénière refuse l'action directe contractuelle du maître de l'ouvrage contre le sous-traitant, consacrant la distinction entre groupes de contrats translatifs de propriété (action directe possible) et non translatifs (action délictuelle seulement).

Portée : Cet arrêt limite l'action directe aux chaînes translatives de propriété et maintient le principe de l'effet relatif des contrats.`,

  "Uber": `Arrêt Uber - Cour de cassation, Chambre sociale, 4 mars 2020, n°19-13.316

Faits : Un chauffeur VTC travaillant pour la plateforme Uber revendiquait la requalification de son contrat en contrat de travail.

Solution : La Cour de cassation requalifie la relation en contrat de travail, relevant que le chauffeur ne pouvait constituer sa propre clientèle, ne fixait pas librement ses tarifs et était soumis aux instructions d'Uber via l'application.

Portée : Arrêt majeur sur le statut des travailleurs des plateformes numériques. Il pose les critères permettant d'établir le lien de subordination caractéristique du contrat de travail.`,

  "Take Eat Easy": `Arrêt Take Eat Easy - Cour de cassation, Chambre sociale, 28 novembre 2018, n°17-20.079

Faits : Un livreur à vélo pour la plateforme Take Eat Easy demandait la requalification de son contrat en contrat de travail.

Solution : La Cour de cassation retient l'existence d'un contrat de travail, relevant le système de géolocalisation en temps réel et le pouvoir de sanction de la plateforme.

Portée : Premier arrêt de la Cour de cassation sur les travailleurs des plateformes numériques, ouvrant la voie à la jurisprudence Uber.`,

  "Jacques Vabre": `Arrêt Jacques Vabre - Cour de cassation, Chambre mixte, 24 mai 1975

Faits : La société Cafés Jacques Vabre contestait l'application d'une taxe fiscale contraire au traité de Rome.

Solution : La Cour de cassation accepte d'écarter une loi postérieure contraire au traité, affirmant la primauté du droit communautaire.

Portée : Arrêt fondateur du contrôle de conventionnalité par le juge judiciaire. La Cour de cassation fait prévaloir le traité sur la loi, même postérieure.`,

  "Desmares": `Arrêt Desmares - Cour de cassation, 2ème chambre civile, 21 juillet 1982, n°81-12.850

Portée : L'arrêt Desmares pose le principe selon lequel la faute de la victime n'exonère le gardien de sa responsabilité que si elle présente les caractères de la force majeure (extériorité, imprévisibilité, irrésistibilité). Cette solution rigoureuse supprime le partage de responsabilité en cas de simple faute de la victime.`,

  "Mennesson": `Arrêt Mennesson - Cour de cassation, Assemblée plénière, 3 juillet 2015, n°14-21.323

Faits : Des époux français avaient eu recours à une gestation pour autrui (GPA) aux États-Unis. Ils demandaient la transcription de l'acte de naissance américain sur les registres français.

Solution : L'Assemblée plénière ordonne la transcription de la filiation paternelle biologique.

Portée : Évolution de la jurisprudence sur la GPA et la filiation. La Cour privilégie l'intérêt de l'enfant et son droit à voir sa filiation établie.`,

  "Flandin": `Arrêt Flandin - Cour de cassation, Chambre commerciale, 18 juin 2003, n°99-19.100

Faits : Un actionnaire minoritaire contestait la mise en réserve systématique des bénéfices depuis plusieurs années.

Solution : La Cour de cassation retient l'abus de majorité, la mise en réserve systématique des bénéfices étant contraire à l'intérêt social et favorisant uniquement les majoritaires.

Portée : Application de la théorie de l'abus de majorité en matière de distribution des dividendes.`,

  "Nikon": `Arrêt Nikon - Cour de cassation, Chambre sociale, 2 octobre 2001, n°99-42.942

Faits : Un employeur avait consulté les fichiers personnels d'un salarié stockés sur son ordinateur professionnel.

Solution : La Cour de cassation affirme que 'le salarié a droit, même au temps et au lieu de travail, au respect de l'intimité de sa vie privée'.

Portée : Arrêt fondateur sur la protection de la vie privée du salarié en entreprise. Il pose le principe du droit au secret des correspondances personnelles sur le lieu de travail.`,

  "Consorts Cruz": `Arrêt Consorts Cruz - Cour de cassation, Assemblée plénière, 5 juillet 2019, n°18-17.665

Faits : Un enfant avait été blessé lors d'un match de rugby par le plaquage d'un autre joueur.

Solution : L'Assemblée plénière retient la responsabilité de l'association sportive sur le fondement de l'article 1242 alinéa 1er du Code civil.

Portée : Confirmation et extension de la responsabilité du fait d'autrui aux associations sportives ayant pour mission d'encadrer les pratiquants.`,

  "Baby Loup": `Arrêt Baby Loup - Cour de cassation, Assemblée plénière, 25 juin 2014

Faits : Une salariée d'une crèche associative avait été licenciée pour avoir refusé d'ôter son voile islamique.

Solution : L'Assemblée plénière valide le licenciement au motif que le règlement intérieur de l'association pouvait prévoir une clause de neutralité.

Portée : Arrêt majeur sur la laïcité en entreprise privée et les possibilités de restriction de la liberté religieuse des salariés.`,
};

// ============================================================================
// PISTE OAuth Authentication
// ============================================================================

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedAccessToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Return cached token if still valid (with 60s buffer)
  if (cachedAccessToken && Date.now() < tokenExpiry - 60000) {
    return cachedAccessToken;
  }

  try {
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
      console.log(`    ⚠️  OAuth error: ${error}`);
      return null;
    }

    const data: OAuthTokenResponse = await response.json();
    cachedAccessToken = data.access_token;
    tokenExpiry = Date.now() + data.expires_in * 1000;
    return cachedAccessToken;
  } catch (error) {
    console.log(`    ⚠️  OAuth error: ${error}`);
    return null;
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchFromJudilibre(
  numero: string
): Promise<JudilibreDecision | null> {
  // Get OAuth token
  const accessToken = await getAccessToken();

  if (!accessToken) {
    return null;
  }

  const headers: Record<string, string> = {
    "accept": "application/json",
    "Authorization": `Bearer ${accessToken}`,
  };

  try {
    // Search by query (using the case number)
    const searchUrl = `${JUDILIBRE_API_URL}/search?query=${encodeURIComponent(numero)}`;
    const searchResponse = await fetch(searchUrl, { headers });

    if (!searchResponse.ok) {
      console.log(`    ⚠️  Judilibre API error: ${searchResponse.status}`);
      return null;
    }

    const searchData: JudilibreSearchResult = await searchResponse.json();

    if (!searchData.results || searchData.results.length === 0) {
      return null;
    }

    // Get full decision
    const decisionId = searchData.results[0].id;
    const decisionUrl = `${JUDILIBRE_API_URL}/decision?id=${decisionId}`;
    const decisionResponse = await fetch(decisionUrl, { headers });

    if (!decisionResponse.ok) {
      console.log(`    ⚠️  Judilibre decision fetch error: ${decisionResponse.status}`);
      return null;
    }

    return await decisionResponse.json();
  } catch (error) {
    console.log(`    ⚠️  Judilibre fetch error: ${error}`);
    return null;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(65));
  console.log("     IMPORT LANDMARK JURISPRUDENCE FROM JUDILIBRE");
  console.log("=".repeat(65));
  console.log("\n");

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials");
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error("❌ Missing MISTRAL_API_KEY");
    process.exit(1);
  }

  // Check PISTE credentials
  const hasPisteCredentials = process.env.PISTE_CLIENT_ID && process.env.PISTE_CLIENT_SECRET;
  if (hasPisteCredentials) {
    console.log("🔑 PISTE credentials found - will try to fetch full text from Judilibre");
    // Test authentication
    const testToken = await getAccessToken();
    if (testToken) {
      console.log("✅ PISTE OAuth authentication successful");
    } else {
      console.log("⚠️  PISTE OAuth authentication failed - using fallback");
    }
  } else {
    console.log("⚠️  No PISTE credentials - using enriched content fallback");
  }
  console.log("\n");

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Read jurisprudences file
  const jsonPath = path.join(__dirname, "jurisprudences-complete.json");
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ File not found: ${jsonPath}`);
    process.exit(1);
  }

  const jsonContent = fs.readFileSync(jsonPath, "utf-8");
  const data: JurisprudencesFile = JSON.parse(jsonContent);
  const jurisprudences = data.jurisprudences;

  console.log(`📊 ${jurisprudences.length} jurisprudences à importer\n`);
  console.log("-".repeat(65));

  const results: ImportResult = {
    imported: [],
    not_found: [],
    already_exists: [],
    errors: [],
  };

  for (let i = 0; i < jurisprudences.length; i++) {
    const jurisprudence = jurisprudences[i];
    const progress = `[${i + 1}/${jurisprudences.length}]`;

    console.log(`${progress} ${jurisprudence.nom}...`);

    try {
      // Check if already exists
      const { data: existing } = await supabase
        .from("court_decisions")
        .select("id")
        .eq("landmark_name", jurisprudence.nom)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`    ⏭️  Déjà existant`);
        results.already_exists.push({
          nom: jurisprudence.nom,
          numero: jurisprudence.numero,
        });
        continue;
      }

      // Try Judilibre API first (only for Cour de cassation decisions)
      let content: string | null = null;
      let sourceUrl = "";
      let source = "enriched";

      const juridictionLower = jurisprudence.juridiction.toLowerCase();
      const isCassation = juridictionLower.includes("cassation") || juridictionLower.startsWith("cass.");

      if (hasPisteCredentials && jurisprudence.numero && isCassation) {
        console.log(`    🔍 Recherche Judilibre: ${jurisprudence.numero}`);
        const judilibreData = await fetchFromJudilibre(jurisprudence.numero);

        if (judilibreData && judilibreData.text) {
          content = judilibreData.text;
          sourceUrl = `https://www.courdecassation.fr/decision/${judilibreData.id}`;
          source = "judilibre";
          console.log(`    ✅ Trouvé sur Judilibre (${judilibreData.text.length} caractères)`);
        } else {
          console.log(`    ℹ️  Non trouvé sur Judilibre`);
        }
        // Rate limiting for API
        await sleep(500);
      } else if (!isCassation) {
        console.log(`    ℹ️  ${jurisprudence.juridiction} - non disponible sur Judilibre`);
      }

      // Fallback to enriched content
      if (!content) {
        const enriched = ENRICHED_CONTENT[jurisprudence.nom];
        if (enriched) {
          content = enriched;
          source = "enriched";
          console.log(`    📝 Utilisation contenu enrichi`);
        }
      }

      // If no content available, create basic entry
      if (!content) {
        content = `Arrêt ${jurisprudence.nom} - ${jurisprudence.juridiction}, ${jurisprudence.date}${jurisprudence.numero ? `, n°${jurisprudence.numero}` : ""}

Thèmes : ${jurisprudence.themes.join(", ")}

Matière : ${jurisprudence.matiere}`;
        source = "basic";
        console.log(`    ⚠️  Contenu basique uniquement`);
      }

      // Generate embedding
      console.log(`    🧠 Génération embedding...`);
      const embedding = await generateEmbedding(content);

      // Insert into database
      const { error: insertError } = await supabase.from("court_decisions").insert({
        title: `Arrêt ${jurisprudence.nom}`,
        landmark_name: jurisprudence.nom,
        date_decision: jurisprudence.date,
        jurisdiction: jurisprudence.juridiction,
        case_number: jurisprudence.numero || null,
        content: content,
        summary: content.substring(0, 500),
        themes: jurisprudence.themes,
        source_url: sourceUrl || null,
        is_landmark: true,
        embedding: embedding,
      });

      if (insertError) {
        console.log(`    ❌ Erreur insertion: ${insertError.message}`);
        results.errors.push({
          nom: jurisprudence.nom,
          numero: jurisprudence.numero,
          error: insertError.message,
        });
      } else {
        console.log(`    ✅ Importé (source: ${source})`);
        results.imported.push({
          nom: jurisprudence.nom,
          numero: jurisprudence.numero,
          source,
        });
      }
    } catch (error) {
      console.log(`    ❌ Erreur: ${error instanceof Error ? error.message : error}`);
      results.errors.push({
        nom: jurisprudence.nom,
        numero: jurisprudence.numero,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Rate limiting
    await sleep(1000);
  }

  // Write results
  const resultsPath = path.join(__dirname, "import-results.json");
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  // Summary
  console.log("\n");
  console.log("=".repeat(65));
  console.log("                      RÉSUMÉ");
  console.log("=".repeat(65));
  console.log("\n");

  console.log(`   ✅ Importés:        ${results.imported.length}`);
  console.log(`   ⏭️  Déjà existants:  ${results.already_exists.length}`);
  console.log(`   ⚠️  Non trouvés:     ${results.not_found.length}`);
  console.log(`   ❌ Erreurs:         ${results.errors.length}`);
  console.log(`   📊 Total traité:    ${jurisprudences.length}`);

  if (results.imported.length > 0) {
    console.log("\n   Importés par source:");
    const bySource: Record<string, number> = {};
    results.imported.forEach((item) => {
      bySource[item.source] = (bySource[item.source] || 0) + 1;
    });
    Object.entries(bySource).forEach(([source, count]) => {
      console.log(`      - ${source}: ${count}`);
    });
  }

  console.log(`\n   📁 Résultats sauvegardés: ${resultsPath}`);

  console.log("\n");
  console.log("=".repeat(65));
  console.log("\n");
}

main().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
