/**
 * Enrichissement complet des jurisprudences landmarks
 *
 * Ce script enrichit TOUS les arrêts landmarks avec des mots-clés juridiques
 * exhaustifs pour optimiser le matching RAG.
 *
 * Usage: npx tsx scripts/enrich-all-landmarks.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";

// ============================================================================
// CONFIGURATION ENRICHISSEMENT
// ============================================================================

interface EnrichmentConfig {
  landmarkName: string;
  keywords: string;
}

const enrichments: EnrichmentConfig[] = [
  // =========================================================================
  // ARRÊTS PRIORITAIRES (problèmes RAG identifiés)
  // =========================================================================
  {
    landmarkName: "Vilgrain",
    keywords: `Mots-clés juridiques: réticence dolosive, devoir de loyauté du dirigeant, obligation d'information précontractuelle, cession de droits sociaux, vice du consentement, dol, dol par omission, silence dolosif.
Articles: article 1116 ancien, article 1137 nouveau, article 1112-1, article 1104 bonne foi.
Expressions: dissimulation information déterminante, manquement devoir loyauté, négociations parallèles dissimulées, obligation transparence dirigeant.
Notions connexes: affectio societatis, actionnaire minoritaire, nullité pour dol, obligation de se renseigner, prix de revente plus-value.
Comparaison: opposition Baldus, devoir d'information vendeur.`
  },
  {
    landmarkName: "Bertrand",
    keywords: `Mots-clés juridiques: responsabilité de plein droit, responsabilité parentale, responsabilité objective, responsabilité sans faute, fait même non fautif du mineur, simple fait causal, responsabilité du fait d'autrui.
Articles: article 1384 alinéa 4 ancien, article 1242 alinéa 4 nouveau, article 1384 alinéa 7.
Conditions: autorité parentale, cohabitation enfant mineur, résidence habituelle, lien de filiation.
Exonérations: force majeure, faute de la victime, cause étrangère, imprévisibilité irrésistibilité.
Arrêts connexes: Fullenwarth 1984, Levert 2001, SAMDA 1997, Assemblée plénière 13 décembre 2002.
Notions: objectivisation responsabilité civile, présomption irréfragable, revirement jurisprudentiel.`
  },
  {
    landmarkName: "Faurecia I",
    keywords: `Mots-clés juridiques: obligation essentielle, clause limitative de responsabilité, réputée non écrite, clause nulle, clause inefficace, cause de l'obligation, substance de l'obligation, prestation caractéristique, noyau dur du contrat.
Articles: article 1131 ancien, article 1170 nouveau, article 1150 ancien, article 1231-3 nouveau.
Contexte: logiciel Oracle V12, manquement obligation essentielle.
Saga jurisprudentielle: Chronopost I 1996, Chronopost II 2002, chambre mixte 2005.
Évolution: position liberticide Faurecia I, retour Chronopost II avec Faurecia II 2010.`
  },
  {
    landmarkName: "Faurecia II",
    keywords: `Mots-clés juridiques: obligation essentielle, clause limitative de responsabilité, réputée non écrite, clause nulle, clause inefficace, contredit portée engagement, économie du contrat, prestation caractéristique, noyau dur du contrat.
Articles: article 1131 ancien, article 1170 nouveau, article 1150 ancien, article 1231-3 nouveau.
Critères: plafond non dérisoire, négociation entre professionnels, équilibre contractuel.
Saga jurisprudentielle: Chronopost I 1996, Chronopost II 2002, Faurecia I 2007.
Consécration: article 1170 réforme 2016.`
  },
  {
    landmarkName: "PIP",
    keywords: `Mots-clés juridiques: implants mammaires défectueux, produit défectueux, prothèses mammaires, organisme notifié certificateur, dispositif médical, marquage CE, matériovigilance, responsabilité du fabricant.
Articles: article 1240 (1382 ancien), article 1245, directive 93/42/CEE dispositifs médicaux, directive 85/374/CEE produits défectueux.
Expressions: obligation contrôle vigilance, gel silicone frauduleux, audit surveillance certification, préjudice anxiété explantation.
Acteurs: TÜV Rheinland, AFSSAPS/ANSM, Poly Implant Prothèse.
Contexte: scandales sanitaires, produits de santé défectueux, responsabilité organismes certification.`
  },

  // =========================================================================
  // CONTRATS - VICES DU CONSENTEMENT
  // =========================================================================
  {
    landmarkName: "Baldus",
    keywords: `Mots-clés juridiques: réticence dolosive rejet, absence obligation information acheteur, droit de faire une bonne affaire, information sur la valeur, dol, vice du consentement.
Articles: article 1137 alinéa 3, article 1112-1 alinéa 2, article 1116 ancien.
Notions: asymétrie d'information, obligation se renseigner vendeur, prix dérisoire vil prix.
Comparaison: opposition Vilgrain, distinction acheteur/vendeur.
Contexte: photographies de collection, Baldus photographe, loi ratification 2018, estimation valeur prestation.`
  },
  {
    landmarkName: "Poussin",
    keywords: `Mots-clés juridiques: erreur sur la substance, erreur sur les qualités essentielles, vice du consentement, conviction erronée, nullité vente.
Articles: article 1110 ancien, article 1132 nouveau, article 1133 nouveau.
Notions: authenticité œuvre d'art, attribution tableau, qualités substantielles.
Contexte: Nicolas Poussin, École Carrache, éléments appréciation postérieurs, doute sur attribution.
Comparaison: aléa accepté Fragonard, droit préemption musées, vente enchères.`
  },
  {
    landmarkName: "Poussin I",
    keywords: `Mots-clés juridiques: erreur sur la substance, erreur sur les qualités essentielles, vice du consentement, conviction erronée, nullité vente.
Articles: article 1110 ancien, article 1132 nouveau, article 1133 nouveau.
Notions: authenticité œuvre d'art, attribution tableau, qualités substantielles.
Contexte: Nicolas Poussin, École Carrache, éléments appréciation postérieurs.
Comparaison: Poussin II, aléa accepté Fragonard, droit préemption musées.`
  },
  {
    landmarkName: "Poussin II",
    keywords: `Mots-clés juridiques: erreur sur la substance, erreur sur les qualités essentielles, vice du consentement, conviction erronée, nullité vente.
Articles: article 1110 ancien, article 1132 nouveau, article 1133 nouveau.
Notions: authenticité œuvre d'art, attribution tableau, qualités substantielles, doute sur attribution.
Contexte: Nicolas Poussin, École Carrache, vente enchères.
Comparaison: Poussin I 1978, Fragonard 1987.`
  },
  {
    landmarkName: "Fragonard",
    keywords: `Mots-clés juridiques: erreur sur la substance, erreur sur les qualités essentielles, authenticité œuvre d'art, aléa accepté, vice du consentement.
Articles: article 1110 ancien, article 1132 nouveau, article 1133 nouveau.
Notions: doute sur attribution, aléa sur authenticité, nullité refusée.
Contexte: tableau Fragonard, vente enchères, expertise artistique.
Comparaison: opposition Poussin, acceptation du doute.`
  },

  // =========================================================================
  // CONTRATS - CLAUSES LIMITATIVES
  // =========================================================================
  {
    landmarkName: "Chronopost",
    keywords: `Mots-clés juridiques: obligation essentielle, clause limitative responsabilité, réputée non écrite, clause nulle, clause inefficace, prestation caractéristique, noyau dur du contrat.
Articles: article 1131 ancien, article 1170 nouveau.
Notions: transport rapide célérité, contredit portée engagement, cause objective subjective.
Contexte: contrat-type messagerie, décret 4 mai 1988, service de livraison express.
Consécration: article 1170 réforme 2016, arrêt fondateur.`
  },
  {
    landmarkName: "Chronopost I",
    keywords: `Mots-clés juridiques: obligation essentielle, clause limitative responsabilité, réputée non écrite, clause nulle, clause inefficace, prestation caractéristique, noyau dur du contrat.
Articles: article 1131 ancien, article 1170 nouveau.
Notions: transport rapide célérité, contredit portée engagement, cause de l'obligation.
Contexte: contrat-type messagerie, retard livraison, service express.
Suite: Chronopost II 2002, Faurecia I et II.`
  },
  {
    landmarkName: "Chronopost II",
    keywords: `Mots-clés juridiques: obligation essentielle, clause limitative responsabilité, faute lourde, plafond légal indemnisation, gravité comportement.
Articles: article 1150 ancien, article 1231-3 nouveau.
Notions: négligence extrême, dépassement plafond, comportement d'une extrême gravité.
Contexte: contrat-type messagerie, décret 4 mai 1988.
Saga: suite Chronopost I 1996, consécration article 1170.`
  },

  // =========================================================================
  // RESPONSABILITÉ DU FAIT D'AUTRUI
  // =========================================================================
  {
    landmarkName: "Blieck",
    keywords: `Mots-clés juridiques: responsabilité générale fait d'autrui, responsabilité de plein droit, responsabilité objective, responsabilité sans faute, garde d'autrui.
Articles: article 1384 alinéa 1 ancien, article 1242 alinéa 1 nouveau.
Notions: abandon caractère limitatif, organiser contrôler mode vie, pouvoir direction contrôle surveillance, charge permanente organisation.
Contexte: CAT centre aide travail, handicapé mental, mission éducative.
Arrêts connexes: Notre-Dame des Flots 1997, associations sportives, centres éducatifs.`
  },
  {
    landmarkName: "Costedoat",
    keywords: `Mots-clés juridiques: immunité civile préposé, responsabilité commettants, responsabilité du fait d'autrui, lien de préposition subordination, irresponsabilité préposé.
Articles: article 1384 alinéa 5 ancien, article 1242 alinéa 5 nouveau.
Conditions: limites de la mission, agir dans le cadre des fonctions.
Exceptions: abus de fonction, infraction pénale intentionnelle (arrêt Cousin 2001), faute civile intentionnelle.
Contexte: pilote hélicoptère traitement herbicide, dépassement mission.`
  },

  // =========================================================================
  // DROIT DU TRAVAIL - PLATEFORMES
  // =========================================================================
  {
    landmarkName: "Uber",
    keywords: `Mots-clés juridiques: requalification contrat travail, lien de subordination juridique, plateforme numérique, chauffeur VTC, ubérisation, économie collaborative.
Articles: article L.8221-6 Code du travail, présomption non-salariat.
Critères: pouvoir de sanction, géolocalisation, désactivation compte, faisceau d'indices, indépendance fictive, service organisé, fixation unilatérale tarifs.
Arrêts connexes: Société Générale 1996, Take Eat Easy, Deliveroo.
Évolution: travail dissimulé, directive 2024/2831 présomption salariat.`
  },
  {
    landmarkName: "Take Eat Easy",
    keywords: `Mots-clés juridiques: requalification contrat travail, lien de subordination juridique, plateforme numérique, coursier livreur vélo, ubérisation, économie collaborative.
Articles: article L.8221-6 Code du travail, présomption non-salariat.
Critères: pouvoir de sanction, géolocalisation, désactivation compte, faisceau d'indices, indépendance fictive, service organisé, fixation unilatérale tarifs.
Contexte: livraison repas, application mobile, travail dissimulé.
Arrêts connexes: Uber, Deliveroo.`
  },
  {
    landmarkName: "Deliveroo",
    keywords: `Mots-clés juridiques: requalification contrat travail, lien de subordination juridique, plateforme numérique, coursier livreur vélo, ubérisation, économie collaborative.
Articles: article L.8221-6 Code du travail, présomption non-salariat.
Critères: pouvoir de sanction, géolocalisation, désactivation compte, faisceau d'indices, indépendance fictive, service organisé, fixation unilatérale tarifs.
Contexte: livraison repas, application mobile.
Arrêts connexes: Uber, Take Eat Easy, directive 2024/2831 présomption salariat.`
  },

  // =========================================================================
  // FAMILLE - GPA
  // =========================================================================
  {
    landmarkName: "Mennesson",
    keywords: `Mots-clés juridiques: GPA, gestation pour autrui, mère porteuse, maternité de substitution, transcription acte naissance, filiation biologique, droit à l'identité, père/mère d'intention.
Articles: article 8 CEDH, articles 16-7 16-9 Code civil, article 47 état civil, article 3§1 CIDE intérêt supérieur enfant.
Concepts: ordre public international, marge d'appréciation, contrôle proportionnalité.
Évolution: CEDH 26 juin 2014, Cass. Ass. plén. 3 juillet 2015, avis consultatif CEDH 10 avril 2019, Protocole 16, circulaire Taubira.
Contexte: GPA États-Unis, refus transcription, violation vie privée enfant.`
  },

  // =========================================================================
  // RESPONSABILITÉ PRODUITS DÉFECTUEUX
  // =========================================================================
  {
    landmarkName: "Médiator",
    keywords: `Mots-clés juridiques: produit défectueux, responsabilité du fabricant, Médiator benfluorex Servier, scandale sanitaire, défaut sécurité.
Articles: article 1245 Code civil, directive 85/374/CEE produits défectueux.
Notions: risque développement exonération refusée, défaut sécurité attente légitime, mise en circulation, cumul responsabilité délictuelle article 1240.
Contexte: valvulopathie, hypertension pulmonaire, ONIAM indemnisation, pharmacovigilance.
Acteurs: laboratoire Servier, Irène Frachon lanceuse alerte.
Preuve: présomptions graves précises concordantes.`
  },
  {
    landmarkName: "Affaire Médiator",
    keywords: `Mots-clés juridiques: produit défectueux, médicament, responsabilité du fabricant, Médiator benfluorex Servier, scandale sanitaire.
Articles: article 1245 Code civil, directive 85/374/CEE produits défectueux.
Notions: risque développement exonération refusée, défaut sécurité, pharmacovigilance.
Contexte: valvulopathie, hypertension pulmonaire, ONIAM indemnisation.
Preuve: présomptions graves précises concordantes, défaut décelable.`
  },
  {
    landmarkName: "Dépakine",
    keywords: `Mots-clés juridiques: produit défectueux, médicament, Dépakine valproate sodium Sanofi, acide valproïque antiépileptique, malformation, responsabilité du fabricant.
Effets: malformations congénitales tératogène, troubles neurodéveloppementaux autisme TDAH, exposition in utero grossesse, spina bifida anomalies tube neural.
Articles: article 1245, directive 85/374/CEE produits défectueux.
Notions: défaut information notice patient, obligation vigilance renforcée, action groupe santé.
Acteurs: Sanofi, APESAC, Marine Martin lanceuse alerte, fonds indemnisation ONIAM valproate.`
  },
  {
    landmarkName: "Levothyrox",
    keywords: `Mots-clés juridiques: produit défectueux, médicament, Levothyrox nouvelle formule Merck, lévothyroxine hypothyroïdie thyroïde, défaut information.
Articles: article 1240 faute délictuelle, article 1245 produits défectueux.
Notions: défaut information conditionnement, excipients mannitol acide citrique, marge thérapeutique étroite, notice emballage étiquetage.
Contexte: changement formule, bioéquivalence, ANSM non-exonératoire.
Préjudice: préjudice moral défaut information, effets indésirables secondaires.
Preuve: présomptions graves précises concordantes.`
  },

  // =========================================================================
  // ENVIRONNEMENT
  // =========================================================================
  {
    landmarkName: "Erika",
    keywords: `Mots-clés juridiques: préjudice écologique pur, préjudice écologique, dommage environnemental, atteinte à l'environnement, marée noire naufrage pétrolier.
Articles: article 1246 Code civil, loi biodiversité 2016, Charte environnement 2005.
Notions: réparation en nature environnement, atteinte non négligeable écosystèmes, fonctions écosystèmes biodiversité, principe pollueur-payeur.
Contexte: Total condamnation, pollution maritime, nomenclature Neyret-Martin.
Procédure: qualité agir associations, LPO.
Droit européen: directive 2004/35/CE responsabilité environnementale.`
  },

  // =========================================================================
  // DROIT EUROPÉEN
  // =========================================================================
  {
    landmarkName: "Jacques Vabre",
    keywords: `Mots-clés juridiques: primauté droit communautaire européen, primauté du droit européen, contrôle de conventionnalité, hiérarchie des normes, effet direct droit européen.
Articles: article 55 Constitution, traité de Rome 1957.
Notions: loi postérieure traité, ordre juridique communautaire propre, juge ordinaire conventionnalité.
Évolution: abandon doctrine Matter, arrêt Nicolo CE 1989, décision IVG CC 1975.
Droit européen: Costa c. Enel CJCE 1964, Simmenthal 1978, libre circulation marchandises.`
  },

  // =========================================================================
  // AUTRES ARRÊTS IMPORTANTS
  // =========================================================================
  {
    landmarkName: "Nikon",
    keywords: `Mots-clés juridiques: vie privée salarié, emails personnels, secret correspondance, droit au respect vie privée travail.
Articles: article 8 CEDH, article 9 Code civil, article L.1121-1 Code du travail.
Notions: contrôle messagerie employeur, fichiers personnels, proportionnalité atteinte, pouvoir direction employeur.
Contexte: ordinateur professionnel, correspondance électronique, licenciement.`
  },
  {
    landmarkName: "Abram",
    keywords: `Mots-clés juridiques: harcèlement moral au travail, harcèlement moral, souffrance au travail, obligation sécurité employeur.
Articles: article L.1152-1 Code du travail, article L.4121-1 obligation sécurité.
Notions: agissements répétés, dégradation conditions travail, atteinte dignité, santé physique mentale.
Contexte: preuve harcèlement, présomption, charge de la preuve.`
  },
  {
    landmarkName: "Orange",
    keywords: `Mots-clés juridiques: harcèlement moral au travail, harcèlement moral institutionnel, harcèlement managérial, souffrance au travail.
Articles: article L.1152-1 Code du travail, article 222-33-2 Code pénal.
Notions: politique d'entreprise, management pathogène, risques psychosociaux, obligation sécurité résultat.
Contexte: France Télécom, vague suicides, restructuration, déflation effectifs.`
  },
  {
    landmarkName: "Soc. Orange",
    keywords: `Mots-clés juridiques: harcèlement moral au travail, harcèlement moral institutionnel, harcèlement managérial, souffrance au travail.
Articles: article L.1152-1 Code du travail, article 222-33-2 Code pénal.
Notions: politique d'entreprise, management pathogène, risques psychosociaux.
Contexte: France Télécom, restructuration, responsabilité pénale dirigeants.`
  },
  {
    landmarkName: "Flandin",
    keywords: `Mots-clés juridiques: abus de majorité, droit des sociétés, nullité délibération, intérêt social.
Articles: article 1833 Code civil, article 1844-10 nullité.
Notions: décision contraire intérêt social, avantage personnel associés majoritaires, rupture égalité.
Contexte: assemblée générale, mise en réserve bénéfices, dividendes.`
  },
  {
    landmarkName: "Les Maréchaux",
    keywords: `Mots-clés juridiques: rupture brutale relations commerciales, préavis, pratiques restrictives de concurrence.
Articles: article L.442-1 Code de commerce (ancien L.442-6 I 5°).
Notions: relation commerciale établie, durée préavis suffisant, brutalité rupture.
Contexte: distribution, franchise, concession, référencement.`
  },
  {
    landmarkName: "Coca-Cola",
    keywords: `Mots-clés juridiques: rupture brutale relations commerciales, rupture brutale, préavis insuffisant, pratiques restrictives de concurrence.
Articles: article L.442-1 Code de commerce (ancien L.442-6 I 5°).
Notions: relation commerciale établie, durée préavis, brutalité rupture, dépendance économique.
Contexte: distribution exclusive, grande distribution, déréférencement.`
  },
  {
    landmarkName: "Fullenwarth",
    keywords: `Mots-clés juridiques: responsabilité parentale, responsabilité du fait d'autrui, fait causal enfant, responsabilité de plein droit.
Articles: article 1384 alinéa 4 ancien, article 1242 alinéa 4 nouveau.
Notions: fait de l'enfant condition responsabilité, faute non exigée, acte cause directe dommage.
Évolution: vers Bertrand 1997, SAMDA 1997.`
  },
  {
    landmarkName: "Levert",
    keywords: `Mots-clés juridiques: responsabilité parentale, cohabitation, résidence alternée, responsabilité du fait d'autrui.
Articles: article 1384 alinéa 4 ancien, article 1242 alinéa 4 nouveau.
Notions: cohabitation condition responsabilité, résidence habituelle, garde juridique.
Contexte: parents séparés, alternance résidence.`
  },
  {
    landmarkName: "Samda",
    keywords: `Mots-clés juridiques: responsabilité parentale, fait non fautif du mineur, responsabilité de plein droit, responsabilité objective.
Articles: article 1384 alinéa 4 ancien, article 1242 alinéa 4 nouveau.
Notions: objectivisation responsabilité, fait causal suffisant, faute non requise.
Évolution: après Fullenwarth 1984, avec Bertrand 1997.`
  }
];

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n");
  console.log("=".repeat(70));
  console.log("     ENRICHISSEMENT COMPLET DES LANDMARKS");
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
  let notFoundCount = 0;
  let errorCount = 0;
  const processed = new Set<string>();

  console.log(`Arrêts à enrichir: ${enrichments.length}\n`);
  console.log("-".repeat(70));

  for (let i = 0; i < enrichments.length; i++) {
    const config = enrichments[i];

    // Skip if already processed (handles duplicates like Chronopost/Chronopost I)
    if (processed.has(config.landmarkName.toLowerCase())) {
      console.log(`[${i + 1}/${enrichments.length}] ${config.landmarkName} - déjà traité`);
      continue;
    }

    console.log(`\n[${i + 1}/${enrichments.length}] ${config.landmarkName}`);

    // Find the landmark
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
      const { data: byTitle } = await supabase
        .from("court_decisions")
        .select("landmark_name, title, summary, case_number")
        .eq("is_landmark", true)
        .ilike("title", `%${config.landmarkName}%`);

      if (!byTitle || byTitle.length === 0) {
        console.log(`   Non trouvé en base`);
        notFoundCount++;
        continue;
      }

      landmarks.push(...byTitle);
    }

    const landmark = landmarks[0];
    processed.add(config.landmarkName.toLowerCase());
    if (landmark.landmark_name) {
      processed.add(landmark.landmark_name.toLowerCase());
    }

    console.log(`   Trouvé: ${landmark.landmark_name || landmark.title}`);

    // Build enriched summary
    const currentSummary = landmark.summary || "";

    // Remove old keywords section if present
    const cleanSummary = currentSummary
      .replace(/\n\nMots-clés juridiques:[\s\S]*$/m, "")
      .replace(/\n\nMots-clés additionnels:[\s\S]*$/m, "")
      .trim();

    const newSummary = cleanSummary + "\n\n" + config.keywords;

    // Generate new embedding
    const textForEmbedding = `${landmark.title || ""} ${newSummary}`;

    try {
      const embedding = await generateEmbedding(textForEmbedding);
      console.log(`   Embedding généré (${embedding.length} dim)`);

      // Update in database
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

      console.log(`   Mise à jour OK`);
      successCount++;

    } catch (embeddingError) {
      const msg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
      console.error(`   Erreur embedding: ${msg}`);
      errorCount++;
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  // Summary
  console.log("\n" + "=".repeat(70));
  console.log("                         RÉSUMÉ");
  console.log("=".repeat(70));
  console.log(`\n   Arrêts enrichis:     ${successCount}`);
  console.log(`   Non trouvés:         ${notFoundCount}`);
  console.log(`   Erreurs:             ${errorCount}`);
  console.log("\n" + "=".repeat(70) + "\n");

  if (errorCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Erreur fatale:", error);
  process.exit(1);
});
