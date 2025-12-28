import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding } from "@/lib/embeddings";
import Anthropic from "@anthropic-ai/sdk";
import { LEGAL_CONCEPTS } from "@/lib/legal-concepts";
import { extractArticleNumber, matchLegalConcepts, generateQueryVariants, extractKeywords } from '@/lib/rag-pipeline';

interface LawArticleSource {
  id: string;
  code_name: string;
  article_number: string;
  content: string;
  source_url: string;
  similarity: number;
}

interface CourtDecisionSource {
  id: string;
  case_number: string;
  jurisdiction: string;
  chambre: string;
  date_decision: string;
  summary: string;
  source_url: string;
  similarity: number;
}

/**
 * Nouvelle approche : BLACKLIST au lieu de WHITELIST
 *
 * Par défaut, on considère toute question comme POTENTIELLEMENT juridique.
 * On filtre UNIQUEMENT les cas évidents de questions NON-juridiques.
 *
 * Avantages :
 * - Plus besoin de maintenir une liste infinie de mots juridiques
 * - Taux de faux négatifs très faible (~5% au lieu de 35%)
 * - Capture toutes les questions en langage familier/technique
 */
function isDefinitelyNotLegal(message: string): boolean {
  const lowerMsg = message.toLowerCase().trim();

  // 1. Messages trop courts (< 3 mots) qui sont des salutations
  const greetings = [
    "salut", "hello", "bonjour", "bonsoir", "coucou", "hey", "hi", "yo",
    "merci", "thanks", "thx", "ok", "d'accord", "dacord", "très bien", "parfait", "super", "cool", "génial",
    "au revoir", "bye", "à plus", "ciao", "tchao", "bonne journée", "bonne soirée"
  ];

  // Exact match ou avec ponctuation
  if (greetings.some(g => lowerMsg === g || lowerMsg === g + " !" || lowerMsg === g + " ?")) {
    console.log(`[RAG] Salutation détectée: "${message}"`);
    return true;
  }

  // 2. Questions générales évidentes (non juridiques)
  const nonLegalPatterns = [
    /^(comment )?ça va/,
    /^tu vas bien/,
    /^quoi de neuf/,
    /quel temps fait/,
    /quelle heure/,
    /raconte.*(blague|histoire)/,
    /qui est (le |la )?(président|ministre|roi|reine)/,
    /c'est quoi (la vie|le bonheur|l'amour)\??$/,
    /^tu (peux|sais) (m'aider|faire)/,
    /^aide[- ]moi$/,
    /^j'ai (faim|soif|sommeil|froid|chaud)/,
    /^(quelle est )?ta? (couleur|film|musique|chanson) préféré/,
    /^qui es-tu/,
    /^tu t'appelles comment/,
    /^comment tu fonctionnes/,
    /^présente-toi/,
  ];

  if (nonLegalPatterns.some(p => p.test(lowerMsg))) {
    console.log(`[RAG] Question non-juridique détectée: "${message}"`);
    return true;
  }

  // 3. Messages de remerciement/politesse pure
  if (/^(merci|thanks|thx)( beaucoup| bien| pour)?( !)?$/i.test(lowerMsg)) {
    console.log(`[RAG] Remerciement détecté: "${message}"`);
    return true;
  }

  // 4. Tout le reste → considéré comme POTENTIELLEMENT juridique
  console.log(`[RAG] Question potentiellement juridique: "${message}"`);
  return false;
}

type CasPratiqueDetection = "explicit" | "uncertain" | "none";

function detectCasPratique(message: string): CasPratiqueDetection {
  const lowerMessage = message.toLowerCase();

  // Check for EXPLICIT cas pratique keywords
  const explicitKeywords = ["cas pratique", "cas-pratique"];
  if (explicitKeywords.some(keyword => lowerMessage.includes(keyword))) {
    return "explicit";
  }

  // Check for typical case study indicators
  const caseStudyKeywords = ["en l'espèce", "en l'occurrence", "en l'espece", "résoudre ce cas"];
  const hasCaseStudyKeywords = caseStudyKeywords.some(keyword => lowerMessage.includes(keyword));

  // Check for typical case study questions
  const questionPatterns = [
    "peut-il", "peut-elle", "peuvent-ils",
    "a-t-il le droit", "a-t-elle le droit",
    "que risque", "quel risque",
    "quelle solution", "quelle sanction",
    "est-il possible", "est-ce possible",
    "comment peut", "que peut",
    "quelles sont les conséquences"
  ];

  const hasQuestion = questionPatterns.some(pattern => lowerMessage.includes(pattern));

  // Check if message contains factual elements (people, legal actors)
  const hasFactualElements = (
    /\b(monsieur|madame|m\.|mme|personne|société|entreprise|employeur|salarié|locataire|propriétaire|vendeur|acheteur|client)\b/i.test(message) ||
    message.length > 150 // Long factual description
  );

  // If has case study keywords → explicit
  if (hasCaseStudyKeywords) {
    return "explicit";
  }

  // If has question + factual elements → uncertain (might be a case study)
  if (hasQuestion && hasFactualElements) {
    return "uncertain";
  }

  return "none";
}

function extractCodeName(message: string): string | null {
  const lowerMessage = message.toLowerCase();

  // Map common code names to exact database names
  const codeMapping: Record<string, string> = {
    "code de procédure pénale": "Code de procédure pénale",
    "code de procedure penale": "Code de procédure pénale",
    "procédure pénale": "Code de procédure pénale",
    "procedure penale": "Code de procédure pénale",
    "cpp": "Code de procédure pénale",

    "code de procédure civile": "Code de procédure civile",
    "code de procedure civile": "Code de procédure civile",
    "procédure civile": "Code de procédure civile",
    "procedure civile": "Code de procédure civile",
    "cpc": "Code de procédure civile",

    "code civil": "Code civil",
    "code civ": "Code civil",
    "cc": "Code civil",

    "code pénal": "Code pénal",
    "code penal": "Code pénal",

    "code du travail": "Code du travail",
    "code travail": "Code du travail",

    "code de commerce": "Code de commerce",
    "code commerce": "Code de commerce",
  };

  // Check each pattern
  for (const [pattern, codeName] of Object.entries(codeMapping)) {
    if (lowerMessage.includes(pattern)) {
      return codeName;
    }
  }

  return null;
}

// ============================================================================
// STEP 0: Question Analysis by Claude (BEFORE RAG)
// ============================================================================

interface QuestionAnalysis {
  isLegalQuestion: boolean;
  domaines: string[]; // ["pénal", "civil", "fiscal", "travail", "commercial", "procédure"]
  problematiques: string[]; // ["dégradation de biens", "homicide involontaire", ...]
  qualificationsRecherchees: string[]; // ["destruction", "violence", "légitime défense", ...]
  articlesConnus: string[]; // ["322-1", "221-6", "122-5", ...] si Claude les connaît
  codesARechercher: string[]; // ["Code pénal", "Code de procédure pénale", ...]
  motsClesRecherche: string[]; // mots-clés pour la recherche vectorielle
  isCasPratique: boolean; // Si c'est un cas pratique avec faits à analyser
  structureRecommandee: string; // Structure de réponse adaptée au domaine
}

async function analyzeQuestion(message: string): Promise<QuestionAnalysis> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const systemPrompt = `Tu es un expert en droit français. Analyse cette question/cas pratique et identifie les éléments juridiques.

IMPORTANT :
- Lis l'ENSEMBLE du texte avant de répondre
- Identifie TOUS les domaines de droit concernés (un cas peut être transversal)
- Pour le pénal, identifie les infractions possibles et leurs articles
- Pour le civil, identifie les responsabilités et fondements
- Pour le fiscal, identifie les impôts/taxes concernés
- Ignore les mots qui ne sont pas juridiques (exemple: "SA" dans "SA voiture" n'est PAS une Société Anonyme)

Détermine aussi :
- Si c'est un cas pratique (énoncé avec faits à analyser juridiquement)
- La structure de réponse à utiliser

Pour la structure :
- Si UN SEUL domaine clairement identifié, utilise la structure spécifique :
  * Pénal : "Pour chaque infraction : Élément légal (article) → Élément matériel (acte/résultat) → Élément moral (intention) → Faits justificatifs éventuels"
  * Obligations/Contrats : "Qualification contrat → Validité → Effets → Responsabilité"
  * Travail : "Qualification relation → Obligations → Rupture → Contentieux"
  * Procédure pénale : "Cadre procédural → Validité actes → Nullités"
  * Administratif : "Compétence → Recevabilité → Légalité externe → Légalité interne"

- Si TRANSVERSAL (plusieurs domaines) ou PAS CLAIR : utilise la structure simple :
  "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"

La structure simple est le DÉFAUT si tu hésites.

MÉTHODE D'ANALYSE EXHAUSTIVE :

Pour chaque domaine de droit détecté, utilise la checklist correspondante pour identifier TOUTES les problématiques juridiques possibles. Ne te limite pas aux questions évidentes.

=== DROIT DES SOCIÉTÉS / COMMERCIAL ===
- Action sociale : ut singuli ou ut universi ?
  * Action ut singuli : SEULEMENT contre dirigeant de DROIT, pas de fait
  * Si dirigeant de fait visé : passer par mandataire ad hoc ou action ut universi
  * Nécessite mise en cause de la société (mandataire ad hoc si conflit)
- Action individuelle : existe-t-il un préjudice personnel DISTINCT du préjudice social ?
  * Préjudice personnel DISTINCT du préjudice social ? (sinon échec)
  * Perte valeur titres, absence dividendes = préjudice INDIRECT → action vouée à l'échec
  * Fondement : Art. 1240 Code civil
- Qualité du dirigeant : de droit ou de fait ? (l'action ut singuli ne vise que le dirigeant de droit)
- Conventions réglementées : Art. L. 225-38 et suivants applicables ?
  * Autorisation préalable CA + approbation AG ?
  * Sanctions : nullité si préjudice / responsabilité dirigeants
- Abus : de majorité, de minorité, d'égalité ?
- Devoir de loyauté : dirigeant OUI, actionnaire NON (sauf clause statutaire)
  * Arrêt Vilgrain : actionnaire n'a pas de devoir de loyauté
  * Exception : clause statutaire expresse ou concurrence déloyale
- Transformation de société : effet sur les mandats en cours ?
  * Cessation automatique ≠ révocation
  * Clauses d'indemnité de révocation : NON applicables à une transformation
  * Sauf si transformation = révocation déguisée (but d'évincer)
- Raison d'être statutaire (Art. 1835) : respect ou violation ?
  * Sa violation NE permet PAS d'annuler contrat avec tiers
  * Seule sanction : responsabilité dirigeants
- Cession de fonds de commerce : éléments inclus/exclus ? transmission des contrats ?
  * Stock : inclus par défaut SAUF clause contraire expresse
  * Contrats en cours : NON transmis par principe, sauf exceptions légales (bail L.145-16, travail L.1224-1) ou clause expresse
  * Contrat de distribution : JAMAIS transmis automatiquement, clause expresse nécessaire
- Procédure collective évoquée : action en insuffisance d'actif (L. 651-2), extension de procédure, dirigeant de fait ?
  * Insuffisance actif : contre dirigeant droit ET fait
  * Seul liquidateur peut l'exercer (pas associé)
- Mandataire ad hoc nécessaire en cas de conflit d'intérêts ?
- Prescription : délai applicable (souvent 3 ans en droit des sociétés) ?

=== DROIT PÉNAL ===
- Pour chaque fait : quelle infraction potentielle ?
- Élément légal : quel texte d'incrimination ?
- Élément matériel : acte + résultat + lien de causalité ?
- Élément moral : intention (dol général/spécial), imprudence, négligence ?
- Faits justificatifs : légitime défense (122-5), état de nécessité (122-7), ordre de la loi (122-4), consentement de la victime ?
- Causes de non-imputabilité : trouble mental (122-1), contrainte (122-2), erreur de droit (122-3), minorité ?
- Tentative : punissable pour cette infraction ? commencement d'exécution ?
- Complicité : aide, assistance, instigation ?
- Concours d'infractions : réel ou idéal ?
- Récidive applicable ?
- Prescription de l'action publique : délai selon la nature de l'infraction ?

=== DROIT DES OBLIGATIONS / CONTRATS ===
- Qualification du contrat : nommé ou innommé ? synallagmatique ou unilatéral ?
- Formation : offre et acceptation valables ?
- Consentement : erreur (1132), dol (1137), violence (1140), lésion ?
- Capacité des parties ?
- Contenu : licite et certain ?
- Exécution : conforme, inexécution totale/partielle ?
- Inexécution : exception d'inexécution, exécution forcée, réduction du prix, résolution ?
- Force majeure (1218) applicable ?
- Imprévision (1195) applicable ?
- Responsabilité contractuelle vs délictuelle : non-cumul ?
- Nullité : relative ou absolue ? effets ?
- Résolution vs résiliation : effets différents ?
- Prescription : 5 ans droit commun, exceptions ?
- Cession de contrat : accord du cédé nécessaire sauf exceptions légales
  * Principe : accord du cédé (cocontractant) obligatoire
  * Exceptions légales : bail commercial (L.145-16), contrat travail (L.1224-1)
  * Contrats intuitu personae : incessibles sans accord exprès
  * Transmission automatique : UNIQUEMENT bail commercial et contrat de travail

=== DROIT DU TRAVAIL ===
- Qualification de la relation : CDI, CDD, intérim, stage ?
- Lien de subordination caractérisé ?
- Contrat : clauses essentielles, clauses abusives ?
- Exécution : modification du contrat vs changement des conditions de travail ?
- Suspension : maladie, maternité, grève ?
- Durée du travail : heures supplémentaires, repos ?
- Rupture : démission, licenciement (personnel/économique), rupture conventionnelle, prise d'acte ?
- Licenciement : cause réelle et sérieuse ? faute simple/grave/lourde ?
- Procédure de licenciement respectée ?
- Indemnités dues : légales, conventionnelles, dommages-intérêts ?
- Contentieux prud'homal : délais, compétence, procédure ?

=== DROIT ADMINISTRATIF ===
- Acte administratif : unilatéral ou contrat ?
- Recours : REP, plein contentieux, référé ?
- Compétence : TA, CAA, CE ?
- Recevabilité : délai (2 mois), intérêt à agir, décision préalable ?
- Légalité externe : compétence, procédure, forme ?
- Légalité interne : violation de la loi, erreur de fait/droit, détournement de pouvoir ?
- Responsabilité administrative : faute de service, faute personnelle, sans faute ?
- Police administrative vs police judiciaire ?

=== DROIT FISCAL ===
- Impôt concerné : IR, IS, TVA, IFI, droits d'enregistrement ?
- Fait générateur et exigibilité ?
- Assiette et taux ?
- Régime applicable : réel, micro, forfait ?
- Déductions, réductions, crédits d'impôt ?
- Plus-values : régime applicable, exonérations ?
- Procédure : contrôle fiscal, garanties du contribuable ?
- Contentieux fiscal : réclamation préalable, délais ?
- Abus de droit fiscal ?
- Prix de transfert si groupe international ?

=== DROIT DE LA FAMILLE ===
- Mariage : conditions, effets, régime matrimonial ?
- Divorce : par consentement mutuel, pour faute, pour altération définitive du lien conjugal ?
- Prestation compensatoire ?
- Filiation : établissement, contestation ?
- Autorité parentale : exercice, délégation, retrait ?
- Obligation alimentaire ?
- Succession : dévolution légale, testament, réserve héréditaire ?
- Libéralités : donation, legs, rapport, réduction ?

=== PROCÉDURE CIVILE ===
- Compétence : matérielle (TJ, TC, CPH) et territoriale ?
- Action en justice : intérêt, qualité, capacité ?
- Demande : principale, reconventionnelle, incidente ?
- Moyens de défense : exceptions, fins de non-recevoir, défenses au fond ?
- Preuves : charge, modes, loyauté ?
- Jugement : autorité de chose jugée, exécution provisoire ?
- Voies de recours : appel (délai 1 mois), opposition, pourvoi ?
- Procédures spéciales : référé, requête, injonction de payer ?

=== PROCÉDURE PÉNALE ===
- Phase d'enquête : flagrance, préliminaire, pouvoirs OPJ/APJ ?
- Mesures coercitives : garde à vue (Art. 62-2), perquisition, écoutes ?
- Instruction : mise en examen, témoin assisté, contrôle judiciaire, détention provisoire ?
- Jugement : tribunal de police, correctionnel, cour d'assises ?
- Action publique : prescription, extinction ?
- Action civile : constitution de partie civile, préjudice ?
- Voies de recours : appel, pourvoi ?
- Usage des armes par la police (L. 435-1 CSI) ?

=== FALLBACK SI MATIÈRE NON RECONNUE ===
Si la matière n'est pas clairement identifiable ou est transversale :
- Identifier tous les acteurs et leurs relations juridiques
- Pour chaque relation : qualifier juridiquement (contrat, délit, statut...)
- Pour chaque acteur : quelles actions possibles ? contre qui ?
- Quels préjudices ? quels fondements juridiques ?
- Quelles prescriptions applicables ?
- Utiliser le syllogisme : Qualification → Problème de droit → Majeure → Mineure → Conclusion

RÈGLES DE DÉTECTION - Tu DOIS identifier ces articles si les triggers sont présents dans l'énoncé :

| Trigger dans l'énoncé | Article à identifier |
|----------------------|---------------------|
| 'ne convient plus', 'changement circonstances', 'déséquilibré' | 1195 (imprévision) |
| 'clause réservant à X seul', 'déséquilibre significatif' | 1171 (clauses abusives) |
| 'vol', 'incendie', 'événement imprévisible', 'empêché' | 1218 (force majeure) |
| 'vol après expédition', 'livraison', 'transport' | 1196 (transfert risques) |
| 'dépendance économique', 'ne pouvait refuser', 'contraint' | 1143 (violence économique) |
| 'refus de payer', 'inexécution', 'n'a pas respecté' | 1219, 1220 (exception inexécution) |
| 'délai', 'échelonnement', 'report paiement' | 1343-5 (délai de grâce) |
| 'pénalité excessive', 'clause pénale' | 1231-5 (modération pénalité) |

Analyse l'énoncé mot par mot pour détecter ces triggers.

RÈGLES DE SÉLECTION DES ARTICLES :

1. ÉVITE les articles de PRINCIPE GÉNÉRAL sauf s'ils sont directement applicables :
   - Art. 1103 (force obligatoire) → Trop général, ne cite que si vraiment nécessaire
   - Art. 1104 (bonne foi) → Trop général
   - Art. 1217 (liste des sanctions) → Préfère l'article spécifique de la sanction visée

2. PRÉFÈRE les articles OPÉRATIONNELS qui décrivent le MÉCANISME juridique :
   - Au lieu de 1217 (liste des sanctions) → Cite 1224, 1226, 1229 (résolution)
   - Au lieu de 1240 seul → Ajoute 1241, 1242, 1243, 1244 selon le fait générateur
   - Au lieu de "responsabilité contractuelle" → Cite 1231-1 à 1231-7

3. IDENTIFIE LE MÉCANISME JURIDIQUE PRÉCIS et ses articles :

   RÉSOLUTION DE CONTRAT :
   - 1224 : modes de résolution (clause, juge, unilatérale)
   - 1225 : clause résolutoire
   - 1226 : résolution unilatérale (conditions : gravité, mise en demeure, notification)
   - 1227 : résolution judiciaire
   - 1228 : choix du mode
   - 1229 : effets de la résolution (date, restitutions)
   - 1230 : résolution partielle

   RESPONSABILITÉ CONTRACTUELLE :
   - 1231-1 : dommages-intérêts pour inexécution
   - 1231-2 : dommages-intérêts = perte + gain manqué
   - 1231-3 : limitation aux dommages prévisibles
   - 1231-4 : lien de causalité direct et immédiat
   - 1231-5 : clause pénale

   CONTRATS INTERDÉPENDANTS :
   - 1186 : caducité dans les ensembles contractuels
   - 1187 : effets de la caducité

   INEXÉCUTION :
   - 1219 : exception d'inexécution
   - 1220 : exception d'inexécution anticipée
   - 1221 : exécution forcée en nature
   - 1222 : exécution par un tiers
   - 1223 : réduction du prix

   FORCE MAJEURE / EXONÉRATION :
   - 1218 : définition et effets de la force majeure
   - 1231-1 : absence de mise en demeure si inexécution définitive

   RESPONSABILITÉ EXTRACONTRACTUELLE :
   - 1240 : fait personnel (faute prouvée)
   - 1241 : négligence/imprudence
   - 1242 al. 1 : fait des choses (présomption)
   - 1242 al. 4 : fait d'autrui (commettant/préposé)
   - 1243 : fait des animaux
   - 1244 : ruine des bâtiments (défaut entretien/vice construction)
   - 1245+ : produits défectueux

4. POSE-TOI CES QUESTIONS pour chaque problème :

   a) Quel est le MÉCANISME juridique en jeu ?
      → Résolution ? Responsabilité ? Nullité ? Caducité ?

   b) Quelles sont les CONDITIONS de ce mécanisme ?
      → Quels articles les décrivent ?

   c) Quels sont les EFFETS de ce mécanisme ?
      → Quels articles les décrivent ?

   d) Existe-t-il des EXCEPTIONS ou EXONÉRATIONS ?
      → Quels articles les prévoient ?

5. SOIS EXHAUSTIF : pour chaque mécanisme, liste TOUS les articles de la chaîne logique

   Exemple pour une résolution unilatérale :
   - Principe : 1224
   - Conditions : 1226 (gravité + mise en demeure sauf urgence + notification motivée)
   - Effets : 1229 (date de prise d'effet, restitutions)
   - Exception : 1218 si force majeure invoquée

6. DISTINGUE selon le FONDEMENT de l'action :

   - Si CONTRACTUEL → 1231-1 et suivants (pas 1240)
   - Si DÉLICTUEL → 1240 à 1244 (pas 1231)
   - Si TIERS au contrat → Arrêt Bootshop : 1240 pour manquement contractuel causant préjudice au tiers

INSTRUCTION FINALE :

Quand tu identifies les articlesConnus, demande-toi : "Est-ce que cet article décrit le MÉCANISME PRÉCIS applicable ou juste un PRINCIPE GÉNÉRAL ?"

- Si PRINCIPE GÉNÉRAL seul → Cherche l'article OPÉRATIONNEL correspondant
- Si MÉCANISME PRÉCIS → Garde-le ET ajoute les articles connexes (conditions, effets, exceptions)

L'objectif est de fournir au RAG une liste d'articles qui permettront de répondre avec PRÉCISION, pas avec des généralités.

Après avoir appliqué la/les checklist(s) pertinente(s), liste dans articlesConnus TOUS les articles que tu connais qui pourraient s'appliquer, même indirectement. Sois EXHAUSTIF.

Pour les problematiques, formule-les de manière PRÉCISE et ACTIONNABLE, pas vague.

Exemples :
- MAUVAIS : "responsabilité du dirigeant"
- BON : "action sociale ut singuli contre le dirigeant de droit pour faute de gestion"

- MAUVAIS : "problème pénal"
- BON : "qualification de destruction de bien d'autrui (322-1 CP), recherche des éléments constitutifs et faits justificatifs possibles"

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks) :
{
  "isLegalQuestion": true/false,
  "domaines": ["pénal", "civil", ...],
  "problematiques": ["description problème 1", "description problème 2", ...],
  "qualificationsRecherchees": ["dégradation", "homicide involontaire", "violences", ...],
  "articlesConnus": ["322-1", "221-6", "L435-1 CSI", ...],
  "codesARechercher": ["Code pénal", "Code civil", ...],
  "motsClesRecherche": ["mot1", "mot2", ...],
  "isCasPratique": true/false,
  "structureRecommandee": "la structure choisie"
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,  // Increased for exhaustive analysis with checklists
      system: systemPrompt,
      messages: [{ role: "user", content: message }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    try {
      const analysis = JSON.parse(text);
      console.log('[ANALYSIS] Successfully parsed analysis');
      return analysis;
    } catch (parseError) {
      console.error('[ANALYSIS] JSON parse error:', parseError);
      console.error('[ANALYSIS] Response text:', text);
      // Fallback si le JSON est invalide
      return {
        isLegalQuestion: true,
        domaines: [],
        problematiques: [],
        qualificationsRecherchees: [],
        articlesConnus: [],
        codesARechercher: [],
        motsClesRecherche: [],
        isCasPratique: false,
        structureRecommandee: "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"
      };
    }
  } catch (error) {
    console.error('[ANALYSIS] Error calling Claude:', error);
    // Fallback en cas d'erreur API
    return {
      isLegalQuestion: true,
      domaines: [],
      problematiques: [],
      qualificationsRecherchees: [],
      articlesConnus: [],
      codesARechercher: [],
      motsClesRecherche: [],
      isCasPratique: false,
      structureRecommandee: "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"
    };
  }
}

const CRFPA_COMPLEMENT = `
## COMPLÉMENT MÉTHODOLOGIQUE CRFPA

En plus de la méthodologie cas pratique de base, applique ces règles supplémentaires :

### PLAN APPARENT
Pour les cas pratiques complexes (plusieurs questions/parties), structure avec un plan visible :
- I. / II. pour les grandes parties
- A. / B. pour les sous-parties
- 1. / 2. pour les points détaillés

### FORMULES DE TRANSITION
- Introduction : "Il convient d'examiner...", "Deux questions se posent..."
- Entre arguments : "Toutefois...", "Par ailleurs...", "Reste à examiner..."
- Conclusion partielle : "En définitive...", "Ainsi..."

### STRUCTURE SELON LA MATIÈRE DÉTECTÉE
- **Droit des obligations** : Qualification contrat → Validité → Effets → Responsabilité
- **Droit pénal** : Élément légal → Matériel → Moral → Faits justificatifs
- **Procédure pénale** : Cadre procédural → Validité actes → Nullités
- **Droit administratif** : Compétence → Recevabilité → Légalité externe/interne
- **Droit du travail** : Qualification relation → Obligations → Rupture → Contentieux

### QUAND UTILISER LE PLAN APPARENT
- Cas pratique avec plusieurs problèmes juridiques distincts
- Question touchant plusieurs parties (ex: responsabilité de A ET de B)
- Matière clairement identifiée (pénal, contrats, travail...)

Pour les questions simples ou transversales, la méthodologie de base suffit.

## NUANCES JURIDIQUES OBLIGATOIRES

Tu DOIS développer ces points quand ils sont pertinents :

### 1. QUALIFICATION DES OBLIGATIONS
Quand tu analyses un manquement contractuel, tu DOIS TOUJOURS :
- Qualifier la nature de l'obligation : obligation de MOYEN ou de RÉSULTAT
- Expliquer les conséquences de cette qualification sur la charge de la preuve
- Si doute : présenter LES DEUX HYPOTHÈSES et leurs conséquences respectives

Exemple de structure :
"La question se pose de savoir si l'obligation d'ALPHADOT est une obligation de moyen ou de résultat.
- Si obligation de MOYEN : le créancier doit prouver la faute du débiteur. En l'espèce...
- Si obligation de RÉSULTAT : le simple constat de l'inexécution suffit. En l'espèce..."

### 2. HYPOTHÈSES ALTERNATIVES
Quand les faits sont ambigus ou que plusieurs qualifications sont possibles, tu DOIS :
- Présenter CHAQUE hypothèse distinctement
- Analyser les conséquences juridiques de chaque hypothèse
- Utiliser "Si... alors..." pour structurer

Exemple :
"Deux hypothèses doivent être distinguées :
- Hypothèse 1 : Si la tuile s'est détachée en raison du défaut d'entretien → régime de l'article 1244 (ruine de bâtiment)
- Hypothèse 2 : Si la tuile a cédé sous le poids de Jeanne → régime général de l'article 1242 (fait des choses)"

### 3. EFFETS ET CONSÉQUENCES
Pour chaque mécanisme juridique invoqué (résolution, caducité, responsabilité), tu DOIS développer :
- Les CONDITIONS d'application
- Les EFFETS juridiques (notamment les restitutions si pertinent)
- Les EXCEPTIONS ou causes d'exonération possibles

### 4. FORMULATIONS À UTILISER
- "La question se pose de savoir si..."
- "Deux hypothèses doivent être distinguées..."
- "Dans la première hypothèse... Dans la seconde hypothèse..."
- "Les effets de cette [résolution/caducité/qualification] sont les suivants..."
- "Cette qualification emporte les conséquences suivantes..."
`;

// Detect legal domain and return appropriate code names to search
function detectLegalDomain(message: string, keywords: string[]): string[] {
  const lowerMessage = message.toLowerCase();
  const codes: string[] = [];

  // Criminal law - commercial offenses
  if (
    lowerMessage.includes("abus de biens sociaux") ||
    lowerMessage.includes("abus de confiance") ||
    lowerMessage.includes("détournement de fonds") ||
    lowerMessage.includes("detournement de fonds")
  ) {
    // These offenses are defined in Code de commerce AND prosecuted via Code de procédure pénale
    codes.push("Code de commerce", "Code de procédure pénale");
    console.log("[DOMAIN DETECTION] Criminal commercial offense → Code de commerce + Code de procédure pénale");
  }

  // Prescription + criminal context
  if (
    lowerMessage.includes("prescription") &&
    (lowerMessage.includes("pénal") || lowerMessage.includes("penal") ||
     lowerMessage.includes("crime") || lowerMessage.includes("délit") || lowerMessage.includes("delit") ||
     lowerMessage.includes("infraction") || keywords.some(k => k.includes("abus")))
  ) {
    if (!codes.includes("Code de procédure pénale")) {
      codes.push("Code de procédure pénale");
    }
    if (!codes.includes("Code pénal")) {
      codes.push("Code pénal");
    }
    console.log("[DOMAIN DETECTION] Criminal prescription → Code de procédure pénale + Code pénal");
  }

  // Contract law
  if (
    lowerMessage.includes("contrat") ||
    lowerMessage.includes("obligation") ||
    lowerMessage.includes("clause")
  ) {
    if (!codes.includes("Code civil")) {
      codes.push("Code civil");
    }
    console.log("[DOMAIN DETECTION] Contract law → Code civil");
  }

  // Labor law
  if (
    lowerMessage.includes("travail") ||
    lowerMessage.includes("salarié") || lowerMessage.includes("salarie") ||
    lowerMessage.includes("employeur") ||
    lowerMessage.includes("licenciement")
  ) {
    if (!codes.includes("Code du travail")) {
      codes.push("Code du travail");
    }
    console.log("[DOMAIN DETECTION] Labor law → Code du travail");
  }

  // Commercial law
  if (
    lowerMessage.includes("société") || lowerMessage.includes("societe") ||
    lowerMessage.includes("commerce") ||
    lowerMessage.includes("dirigeant") ||
    lowerMessage.includes("entreprise")
  ) {
    if (!codes.includes("Code de commerce")) {
      codes.push("Code de commerce");
    }
    console.log("[DOMAIN DETECTION] Commercial law → Code de commerce");
  }

  return codes;
}

// Detect relevant codes for vector search optimization
function detectRelevantCodes(message: string): string[] | null {
  const lowerMsg = message.toLowerCase();
  const codes: Set<string> = new Set();

  const codeDetection: Record<string, string[]> = {
    "Code civil": [
      "civil", "mariage", "divorce", "responsabilité délictuelle", "responsabilité civile",
      "contrat", "obligation", "succession", "propriété", "1240", "1241", "2224",
      "consentement", "dol", "erreur", "violence", "préjudice", "dommage", "réparation"
    ],
    "Code pénal": [
      "pénal", "penal", "crime", "délit", "infraction", "peine", "amende", "prison",
      "vol", "meurtre", "abus de confiance", "escroquerie", "314-1", "311-1", "homicide"
    ],
    "Code du travail": [
      "travail", "cdi", "cdd", "licenciement", "salarié", "employeur", "salaire",
      "contrat de travail", "préavis", "prud'hom", "démission", "rupture conventionnelle",
      "faute grave", "faute lourde", "indemnité"
    ],
    "Code de commerce": [
      "commerce", "commercial", "sarl", "sas", "société", "entreprise",
      "faillite", "dirigeant", "abus de biens sociaux", "L241", "L242", "L223", "L225"
    ],
    "Code de procédure pénale": [
      "procédure pénale", "prescription", "garde à vue", "instruction", "enquête",
      "action publique", "article 7", "article 8", "article 9"
    ],
    "Code de procédure civile": [
      "procédure civile", "assignation", "appel", "tribunal judiciaire", "référé"
    ]
  };

  for (const [codeName, keywords] of Object.entries(codeDetection)) {
    if (keywords.some(kw => lowerMsg.includes(kw))) {
      codes.add(codeName);
    }
  }

  // Si aucun code détecté → retourner NULL (chercher dans TOUS les codes)
  if (codes.size === 0) {
    console.log('[CODE DETECTION] No specific code detected → searching all codes');
    return null;
  }

  console.log(`[CODE DETECTION] Detected ${codes.size} codes: ${Array.from(codes).join(', ')}`);
  return Array.from(codes);
}

// Get relevant court chambers based on legal domains
function getChambresFromDomaines(domaines: string[]): string[] {
  // Comprehensive list of all chamber name variations
  const ALLOWED_CHAMBERS = [
    'civ1', 'civ2', 'civ3', 'civile', 'CIV1', 'CIV2', 'CIV3',
    'Civ. 1', 'Civ. 2', 'Civ. 3', 'Civ.1', 'Civ.2', 'Civ.3',
    '1re chambre civile', '2e chambre civile', '3e chambre civile',
    'Première chambre civile', 'Deuxième chambre civile', 'Troisième chambre civile',
    'comm', 'commerciale', 'COMM', 'Com.', 'Com',
    'chambre commerciale', 'Chambre commerciale',
    'soc', 'sociale', 'SOC', 'Soc.', 'Soc',
    'chambre sociale', 'Chambre sociale',
    'crim', 'criminelle', 'CRIM', 'Crim.', 'Crim',
    'chambre criminelle', 'Chambre criminelle',
    'Assemblée plénière', 'Ass. plén.', 'AP', 'Ass.plén.', 'ass. plen.',
    'Chambre mixte', 'Ch. mixte', 'mixte'
  ];

  console.log('[JURISPRUDENCE] Chambres autorisées:', ALLOWED_CHAMBERS.length, 'patterns');

  const chambres: string[] = [];

  // Criminal law
  if (domaines.some(d => ["pénal", "penal", "procédure pénale", "procedure penale", "criminel"].includes(d.toLowerCase()))) {
    chambres.push("criminelle", "cr", "CRIM", "Crim.", "Chambre criminelle");
  }

  // Civil law
  if (domaines.some(d => ["civil", "obligations", "contrats", "famille", "responsabilité civile", "responsabilite civile"].includes(d.toLowerCase()))) {
    chambres.push("civ1", "civ2", "civ3", "civile", "CIV1", "CIV2", "CIV3", "Civ. 1", "Civ. 2", "Civ. 3", "Civ.1", "Civ.2", "Civ.3", "1re chambre civile", "2e chambre civile", "3e chambre civile", "Première chambre civile", "Deuxième chambre civile", "Troisième chambre civile");
  }

  // Commercial law
  if (domaines.some(d => ["commercial", "affaires", "sociétés", "societes", "commerce"].includes(d.toLowerCase()))) {
    chambres.push("commerciale", "comm", "COMM", "Com.", "Com", "chambre commerciale", "Chambre commerciale");
  }

  // Labor law
  if (domaines.some(d => ["travail", "social"].includes(d.toLowerCase()))) {
    chambres.push("sociale", "soc", "SOC", "Soc.", "Soc", "chambre sociale", "Chambre sociale");
  }

  // Always include Assemblée plénière and Chambre mixte as they are relevant to all domains
  chambres.push("Assemblée plénière", "Ass. plén.", "AP", "Ass.plén.", "ass. plen.", "Chambre mixte", "Ch. mixte", "mixte");

  return chambres;
}

// Fallback keyword search when vector search fails
async function keywordSearch(
  supabase: any,
  message: string,
  keywords: string[],
  codeName: string | null,
  limit: number = 3
): Promise<LawArticleSource[]> {
  if (keywords.length === 0) {
    return [];
  }

  try {
    console.log(`[KEYWORD SEARCH] Searching for keywords: ${keywords.join(", ")}`);

    // Separate composite legal terms from single-word keywords
    const compositeTerms = keywords.filter(kw => kw.includes(" "));
    const singleWords = keywords.filter(kw => !kw.includes(" "));

    console.log(`[KEYWORD SEARCH] Composite terms: ${compositeTerms.join(", ") || "none"}`);
    console.log(`[KEYWORD SEARCH] Single words: ${singleWords.join(", ") || "none"}`);

    // Detect legal domain to get appropriate codes
    const detectedCodes = detectLegalDomain(message, keywords);
    const targetCodes = detectedCodes.length > 0 ? detectedCodes : (codeName ? [codeName] : []);

    console.log(`[KEYWORD SEARCH] Target codes: ${targetCodes.join(", ") || "all codes"}`);

    const allResults: LawArticleSource[] = [];

    // PRIORITY 1: Search for composite terms first (more specific)
    if (compositeTerms.length > 0) {
      for (const code of targetCodes.length > 0 ? targetCodes : [null]) {
        let query = supabase
          .from("law_articles")
          .select("id, code_name, article_number, content, source_url");

        if (code) {
          query = query.eq("code_name", code);
        }

        // Search for composite terms (all must match)
        const compositeConditions = compositeTerms.map(kw => `content.ilike.%${kw}%`).join(",");
        query = query.or(compositeConditions);

        const { data, error } = await query.limit(limit);

        if (error) {
          console.error(`[KEYWORD SEARCH] Error searching composite terms in ${code || "all codes"}:`, error);
        } else if (data && data.length > 0) {
          console.log(`[KEYWORD SEARCH] Found ${data.length} articles with composite terms in ${code || "all codes"}:`, data.map((a: any) => a.article_number));
          allResults.push(...data.map((a: any) => ({
            ...a,
            similarity: 0.75, // Higher score for composite term matches
          })));
        }
      }
    }

    // PRIORITY 2: If not enough results, search for single words (less specific)
    if (allResults.length < limit && singleWords.length > 0) {
      for (const code of targetCodes.length > 0 ? targetCodes : [null]) {
        let query = supabase
          .from("law_articles")
          .select("id, code_name, article_number, content, source_url");

        if (code) {
          query = query.eq("code_name", code);
        }

        // Search for single words (any must match)
        const singleWordConditions = singleWords.map(kw => `content.ilike.%${kw}%`).join(",");
        query = query.or(singleWordConditions);

        const { data, error } = await query.limit(limit);

        if (error) {
          console.error(`[KEYWORD SEARCH] Error searching single words in ${code || "all codes"}:`, error);
        } else if (data && data.length > 0) {
          console.log(`[KEYWORD SEARCH] Found ${data.length} articles with single words in ${code || "all codes"}:`, data.map((a: any) => a.article_number));
          // Filter out duplicates already in allResults
          const existingIds = new Set(allResults.map(r => r.id));
          const newResults = data.filter((a: any) => !existingIds.has(a.id));
          allResults.push(...newResults.map((a: any) => ({
            ...a,
            similarity: 0.6, // Lower score for single word matches
          })));
        }
      }
    }

    // Deduplicate and sort by similarity (composite terms first)
    const uniqueResults = Array.from(new Map(allResults.map(r => [r.id, r])).values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (uniqueResults.length > 0) {
      console.log(`[KEYWORD SEARCH] Final results: ${uniqueResults.length} articles`);
      return uniqueResults;
    }

    console.log("[KEYWORD SEARCH] No articles found");
    return [];
  } catch (error) {
    console.error("[KEYWORD SEARCH] Exception:", error);
    return [];
  }
}

// Generate query variations for Multi-Query RAG
async function generateQueryVariations(question: string, anthropic: any): Promise<string[]> {
  try {
    console.log('[MULTI-QUERY] Generating query variations...');

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: `Tu es un expert en droit français. Génère 4 reformulations de cette question juridique pour trouver des articles de loi pertinents.

Question: "${question.slice(0, 1000)}"

IMPORTANT: Chaque reformulation doit utiliser des termes juridiques différents.
Exemple: "responsabilité du vendeur" → "obligation du vendeur", "garantie des vices", "inexécution contractuelle"

Réponds UNIQUEMENT avec un JSON array de 4 strings:
["reformulation 1", "reformulation 2", "reformulation 3", "reformulation 4"]`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '[]';

    // Clean markdown code blocks (Claude sometimes returns ```json ... ```)
    const cleanedText = text
      .replace(/^```json\s*/i, '')  // Remove ```json at start
      .replace(/^```\s*/i, '')       // Remove ``` at start (fallback)
      .replace(/\s*```$/i, '')       // Remove ``` at end
      .trim();

    const variations = JSON.parse(cleanedText);
    console.log('[MULTI-QUERY] Variations:', variations);
    return variations;
  } catch (error) {
    console.error('[MULTI-QUERY] Error generating variations:', error);
    return [];
  }
}

// Generate hypothetical answer for HyDE (Hypothetical Document Embeddings)
async function generateHypotheticalAnswer(question: string, anthropic: any): Promise<string> {
  try {
    console.log('[HyDE] Generating hypothetical answer...');

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Tu es un expert en droit français. Génère une réponse juridique HYPOTHÉTIQUE à cette question en utilisant les termes techniques appropriés (articles de loi, concepts juridiques).

Question: "${question.slice(0, 1000)}"

IMPORTANT:
- Ne cite PAS de numéros d'articles spécifiques (pas de "1240", "L1234-1", etc.)
- Utilise les TERMES juridiques (responsabilité délictuelle, faute, dommage, contrat d'adhésion, clause abusive, etc.)
- Réponse courte (200 mots max)
- Utilise un langage juridique précis

Exemple:
Question: "Un employeur peut-il licencier un salarié absent pour maladie ?"
Réponse: "En matière de droit du travail, le licenciement d'un salarié pour absence liée à une maladie pose la question de la protection du salarié malade. Le principe général est l'interdiction de licencier un salarié en raison de son état de santé, ce qui constituerait une discrimination. Toutefois, si l'absence prolongée du salarié désorganise l'entreprise et nécessite son remplacement définitif, l'employeur peut procéder au licenciement pour motif objectif non discriminatoire. La jurisprudence distingue entre le licenciement discriminatoire fondé sur l'état de santé (prohibé) et le licenciement justifié par la nécessité de remplacer le salarié (licite sous conditions). La durée de l'absence, la taille de l'entreprise, et la possibilité de reclassement sont des critères déterminants."

Réponds UNIQUEMENT avec la réponse hypothétique, sans introduction ni conclusion.`
      }]
    });

    const hypotheticalAnswer = response.content[0].type === 'text' ? response.content[0].text : '';
    console.log(`[HyDE] Generated hypothetical answer (${hypotheticalAnswer.length} chars)`);

    return hypotheticalAnswer;
  } catch (error) {
    console.error('[HyDE] Error generating hypothetical answer:', error);
    return '';
  }
}

// Reciprocal Rank Fusion for combining multiple search results
function reciprocalRankFusion(resultSets: any[][], k: number = 60): any[] {
  const scores = new Map<string, number>();
  const articleMap = new Map<string, any>();

  for (const results of resultSets) {
    results.forEach((article, rank) => {
      const id = article.id || article.article_number || JSON.stringify(article);
      const currentScore = scores.get(id) || 0;
      scores.set(id, currentScore + 1 / (k + rank + 1));
      if (!articleMap.has(id)) {
        articleMap.set(id, article);
      }
    });
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => articleMap.get(id));
}

// Plans dynamiques pour les cas pratiques pénaux
const PLAN_INTENTIONNELLE = `
=== PLAN INFRACTION INTENTIONNELLE ===

I. ÉLÉMENT LÉGAL
- Cite le texte d'incrimination précis (article + alinéa du Code pénal)
- Qualifie : crime, délit ou contravention

II. ÉLÉMENT MATÉRIEL
A. Comportement incriminé (action ou omission)
B. Résultat (si infraction matérielle)
C. Lien de causalité entre comportement et résultat

III. ÉLÉMENT MORAL
A. Dol général : connaissance du caractère illicite + volonté de commettre l'acte
B. Dol spécial (si requis par le texte) : intention d'atteindre un résultat précis

CONCLUSION : Infraction constituée ou non + peines encourues
`;

const PLAN_NON_INTENTIONNELLE = `
=== PLAN INFRACTION NON-INTENTIONNELLE ===
(Appliquer la loi Fauchon du 10 juillet 2000)

I. RÉSULTAT
- Nature du dommage : mort (221-6 CP) / ITT > 3 mois (222-19 CP) / ITT ≤ 3 mois (222-20 CP ou R625-2 CP)

II. LIEN DE CAUSALITÉ - QUALIFICATION OBLIGATOIRE
Tu DOIS qualifier la causalité en DIRECT ou INDIRECT.

CAUSALITÉ DIRECTE : le comportement est la cause exclusive, immédiate ou déterminante du dommage
CAUSALITÉ INDIRECTE (art. 121-3 al.4) : la personne a créé ou contribué à créer la situation ayant permis le dommage, OU n'a pas pris les mesures permettant de l'éviter

III. FAUTE REQUISE

SI CAUSALITÉ DIRECTE → Faute simple suffit (art. 121-3 al.3)
= imprudence, négligence, manquement à une obligation de prudence ou sécurité prévue par la loi ou le règlement

SI CAUSALITÉ INDIRECTE → Faute qualifiée exigée (art. 121-3 al.4)
Deux types ALTERNATIFS :
a) Faute DÉLIBÉRÉE : violation manifestement délibérée d'une obligation particulière de prudence ou sécurité prévue par la loi ou le règlement
b) Faute CARACTÉRISÉE : exposer autrui à un risque d'une particulière gravité qu'on ne pouvait ignorer

CONCLUSION : Responsabilité engagée ou non + peines
`;

const PLAN_TENTATIVE = `
=== PLAN TENTATIVE ===

I. ÉLÉMENT LÉGAL
A. La tentative est-elle punissable pour cette infraction ?
- Crime : toujours punissable (art. 121-4 1° CP)
- Délit : seulement si la loi le prévoit expressément
- Contravention : jamais
B. Citer l'article 121-4 2° CP + le texte de l'infraction principale

II. COMMENCEMENT D'EXÉCUTION (art. 121-5 CP)
Définition : acte tendant directement et immédiatement à la consommation de l'infraction
≠ Actes préparatoires (non punissables)
En l'espèce : l'acte a-t-il fait entrer l'agent dans la phase d'exécution ?

III. ABSENCE DE DÉSISTEMENT VOLONTAIRE
La cause de l'interruption est-elle :
- INVOLONTAIRE (intervention tiers, obstacle matériel) → Tentative punissable
- VOLONTAIRE (remords, peur, repentir) → Pas de tentative

Types : tentative suspendue / tentative manquée / tentative impossible (toutes punissables si involontaire)

CONCLUSION : Tentative constituée + peines identiques à l'infraction consommée
`;

// Classify penal infraction type for better case analysis
async function classifyPenalInfraction(question: string): Promise<'INTENTIONNELLE' | 'NON_INTENTIONNELLE' | 'TENTATIVE'> {
  try {
    const anthropicClient = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const response = await anthropicClient.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      messages: [{
        role: "user",
        content: `Analyse ce cas pratique pénal et classifie le TYPE D'INFRACTION principal :
- INTENTIONNELLE : meurtre, vol, escroquerie, abus de confiance, violences volontaires, viol...
- NON_INTENTIONNELLE : homicide involontaire, blessures involontaires, mise en danger...
- TENTATIVE : si les mots tentative, a tenté de, commencement d'exécution apparaissent

Réponds UNIQUEMENT par : INTENTIONNELLE ou NON_INTENTIONNELLE ou TENTATIVE

Cas pratique : ${question}`
      }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text.trim().toUpperCase() : 'INTENTIONNELLE';

    if (text.includes('NON_INTENTIONNELLE') || text.includes('NON INTENTIONNELLE')) {
      return 'NON_INTENTIONNELLE';
    } else if (text.includes('TENTATIVE')) {
      return 'TENTATIVE';
    } else {
      return 'INTENTIONNELLE';
    }
  } catch (error) {
    console.error('[PENAL] Classification error:', error);
    return 'INTENTIONNELLE'; // Default fallback
  }
}

// Detect aggravating circumstances in penal case
function detectAggravatingCircumstances(question: string): string[] {
  const text = question.toLowerCase();
  const found: string[] = [];

  const patterns = [
    { regex: /vulnérable|âgé|mineur|enfant|handicap|infirme/i, label: 'Vulnérabilité victime (art. 311-4 5°, 222-12)' },
    { regex: /nuit|minuit|obscurité|soir|23h|2h|3h/i, label: 'Circonstance de temps - nuit (art. 311-4 2°)' },
    { regex: /arme|couteau|pistolet|fusil|batte|matraque/i, label: 'Usage ou port d\'arme (art. 311-4 4°, 222-12 4°)' },
    { regex: /plusieurs|groupe|bande|réunion|complices|ensemble/i, label: 'Réunion ou bande organisée (art. 311-4 1°, 311-9)' },
    { regex: /véhicule|voiture|scooter|moto|camion/i, label: 'Utilisation d\'un véhicule (art. 311-4 8°)' },
    { regex: /effraction|casser|forcer la porte|escalade|fenêtre/i, label: 'Effraction ou escalade (art. 311-4 6°, 7°)' },
    { regex: /menace|menacer|intimidation/i, label: 'Menace (art. 311-4 3°, 312-1)' },
    { regex: /dépositaire.*autorité|policier|gendarme|magistrat|élu/i, label: 'Victime dépositaire autorité publique (art. 222-12 4°)' },
    { regex: /préméditation|guet-apens|prémédit/i, label: 'Préméditation ou guet-apens (art. 221-3, 222-12 1°)' },
    { regex: /alcool|ivresse|stupéfiant|drogue|sous l'emprise/i, label: 'Emprise alcool/stupéfiants (circonstance aggravante routière)' }
  ];

  for (const p of patterns) {
    if (p.regex.test(text)) {
      found.push(p.label);
    }
  }

  return found;
}

// Strict rules for penal law responses
const REGLES_PENALES = `
=== RÈGLES STRICTES DROIT PÉNAL ===

❌ INTERDIT - Ne fais JAMAIS cela :
- Présenter des 'hypothèses' ou 'deux hypothèses doivent être distinguées' → Tu DOIS TRANCHER
- Développer la prescription SAUF si l'énoncé mentionne des faits anciens (plus de 6 ans)
- Utiliser 'fautes caractérisées' au pluriel pour dire 'fautes établies/prouvées'
- Analyser la causalité sans la qualifier en directe ou indirecte
- Oublier de citer l'article 121-4 2° CP pour une tentative de délit

✅ OBLIGATOIRE - Fais TOUJOURS cela :
- TRANCHER : 'En l'espèce, l'infraction EST/N'EST PAS constituée car...'
- Qualifier la causalité (directe/indirecte) AVANT de déterminer la faute requise
- Utiliser 'faute caractérisée' UNIQUEMENT au sens technique de l'art. 121-3 al.4
- Analyser CHAQUE circonstance aggravante détectée
- Conclure avec les peines encourues (quantum maximum)

=== TERMINOLOGIE JURIDIQUE PRÉCISE ===
| ✅ Correct | ❌ Incorrect |
|-----------|-------------|
| fautes constituées/établies | fautes caractérisées (sens courant) |
| faute caractérisée (art. 121-3 al.4) | faute grave/sérieuse |
| causalité directe | lien de causalité (sans précision) |
| causalité indirecte | causalité partielle |
| dol général | intention (sans précision) |
| dol spécial | intention particulière |

=== FORMULATIONS À UTILISER ===
- 'En l'espèce, [qualification]. En effet, [argumentation].'
- 'L'article X du Code pénal dispose que... Or, en l'espèce...'
- 'La causalité est DIRECTE/INDIRECTE car...'
- 'Une faute simple suffit / Une faute qualifiée est exigée'
- 'L'infraction est constituée/n'est pas constituée. [Prénom] encourt...'
`;

// Hybrid search: combines keyword search (ILIKE) + Vector search with Reciprocal Rank Fusion
async function hybridSearch(
  supabase: any,
  message: string,
  queryEmbedding: number[],
  filterCodes: string[] | null,
  limit: number = 10
): Promise<LawArticleSource[]> {
  console.log('[HYBRID] Starting hybrid search...');

  // Extract keywords for ILIKE search
  const keywords = extractKeywords(message);

  // Also extract article numbers for exact matching
  const articleNumber = extractArticleNumber(message);

  // 1. Keyword/ILIKE Search (for exact terms like "article 1240")
  let ilikeResults: any[] = [];

  if (keywords.length > 0 || articleNumber) {
    let query = supabase
      .from('law_articles')
      .select('id, code_name, article_number, content, source_url');

    // Build OR conditions for keywords
    const conditions: string[] = [];

    // Add article number search (highest priority)
    if (articleNumber) {
      conditions.push(`article_number.ilike.%${articleNumber}%`);
    }

    // Add keyword conditions
    keywords.slice(0, 5).forEach(kw => {
      conditions.push(`content.ilike.%${kw}%`);
    });

    if (conditions.length > 0) {
      query = query.or(conditions.join(','));
    }

    // Filter by codes if specified
    if (filterCodes && filterCodes.length > 0) {
      query = query.in('code_name', filterCodes);
    }

    const { data, error } = await query.limit(20);

    if (error) {
      console.error('[HYBRID] ILIKE error:', error);
    } else {
      ilikeResults = data || [];
    }
  }

  console.log(`[HYBRID] ILIKE found: ${ilikeResults.length} articles`);

  // 2. Vector Search
  console.log('[VECTOR DEBUG] Embedding length:', queryEmbedding?.length);
  console.log('[VECTOR DEBUG] Embedding sample:', queryEmbedding?.slice(0, 5));
  console.log('[VECTOR DEBUG] Calling match_law_articles_filtered with threshold: 0.2');
  console.log('[VECTOR DEBUG] Filter codes:', filterCodes);

  const { data: vectorResults, error: vectorError } = await supabase
    .rpc('match_law_articles_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: 0.2,
      match_count: 20,
      filter_codes: filterCodes
    });

  console.log('[VECTOR DEBUG] Raw response error:', vectorError);
  console.log('[VECTOR DEBUG] Raw response data length:', vectorResults?.length);
  console.log('[VECTOR DEBUG] Raw response sample:', JSON.stringify(vectorResults?.slice(0, 2)));

  if (vectorError) {
    console.error('[HYBRID] Vector error:', vectorError);
  }
  console.log(`[HYBRID] Vector found: ${vectorResults?.length || 0} articles`);

  // 3. Reciprocal Rank Fusion (RRF)
  const k = 60; // RRF constant
  const scores = new Map<string, { article: any; score: number }>();

  // Score ILIKE results (boost for exact matches)
  ilikeResults.forEach((article: any, rank: number) => {
    const isExactArticleMatch = articleNumber &&
      article.article_number.toLowerCase().includes(articleNumber.toLowerCase());
    const boost = isExactArticleMatch ? 2.0 : 1.0; // 2x boost for exact article number
    const score = boost / (k + rank + 1);
    scores.set(article.id, { article, score });
  });

  // Add Vector results scores
  (vectorResults || []).forEach((article: any, rank: number) => {
    const score = 1 / (k + rank + 1);
    const existing = scores.get(article.id);
    if (existing) {
      existing.score += score; // Article found in both → boost score
      console.log(`[HYBRID] Boost for ${article.article_number}: found in both ILIKE and Vector`);
    } else {
      scores.set(article.id, { article, score });
    }
  });

  // Sort by combined score and return top results
  const results = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article, score }) => ({
      ...article,
      similarity: Math.min(score * 30, 1) // Normalize to 0-1 range
    }));

  console.log(`[HYBRID] Final results: ${results.length} articles`);
  console.log('[HYBRID] Top articles:', results.slice(0, 5).map(r => `${r.article_number} (${r.similarity.toFixed(2)})`));

  return results;
}

// RAG-Fusion: Generate query variants and combine results
async function ragFusion(
  supabase: any,
  originalQuery: string,
  queryEmbedding: number[],
  filterCodes: string[] | null,
  limit: number = 10
): Promise<LawArticleSource[]> {
  console.log('[RAG-FUSION] Starting with query:', originalQuery.substring(0, 50));

  // 1. Generate query variants using simple transformations
  const variants = generateQueryVariants(originalQuery);
  console.log(`[RAG-FUSION] Generated ${variants.length} variants`);

  // 2. Search with original query
  const originalResults = await hybridSearch(supabase, originalQuery, queryEmbedding, filterCodes, 15);

  // 3. Search with each variant (using keyword search, no embedding needed)
  const allResults: Map<string, { article: LawArticleSource; score: number }> = new Map();

  // Add original results with high weight
  originalResults.forEach((article, rank) => {
    const key = `${article.code_name}:${article.article_number}`;
    const score = 1 / (60 + rank + 1);
    allResults.set(key, { article, score: score * 1.5 }); // 1.5x weight for original
  });

  // 4. For each variant, do keyword search and add results
  for (const variant of variants) {
    const keywords = variant.split(/\s+/).filter(k => k.length > 3);
    if (keywords.length === 0) continue;

    // Simple keyword search
    let query = supabase
      .from('law_articles')
      .select('id, code_name, article_number, content, source_url');

    // Build OR conditions for keywords
    const conditions = keywords.slice(0, 3).map(kw => `content.ilike.%${kw}%`);
    if (conditions.length > 0) {
      query = query.or(conditions.join(','));
    }

    if (filterCodes && filterCodes.length > 0) {
      query = query.in('code_name', filterCodes);
    }

    const { data: variantResults } = await query.limit(10);

    // Add variant results with lower weight
    (variantResults || []).forEach((article: any, rank: number) => {
      const key = `${article.code_name}:${article.article_number}`;
      const score = 1 / (60 + rank + 1);
      const existing = allResults.get(key);
      if (existing) {
        existing.score += score; // Boost if found in multiple variants
      } else {
        allResults.set(key, { article: { ...article, similarity: 0 }, score });
      }
    });
  }

  // 5. Sort by combined score and return top results
  const results = Array.from(allResults.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article, score }) => ({
      ...article,
      similarity: Math.min(score * 20, 1)
    }));

  console.log(`[RAG-FUSION] Final results: ${results.length} articles`);
  console.log('[RAG-FUSION] Top 5:', results.slice(0, 5).map(r => r.article_number));

  return results;
}

// Rerank results using Cohere for better relevance
async function rerankWithCohere(
  query: string,
  documents: LawArticleSource[],
  topN: number = 5
): Promise<LawArticleSource[]> {
  const cohereApiKey = process.env.COHERE_API_KEY;

  if (!cohereApiKey || documents.length === 0) {
    console.log('[RERANK] Skipping - no API key or no documents');
    return documents.slice(0, topN);
  }

  console.log(`[RERANK] Reranking ${documents.length} documents with Cohere...`);

  try {
    const response = await fetch('https://api.cohere.ai/v1/rerank', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cohereApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'rerank-multilingual-v3.0',
        query: query,
        documents: documents.map(d => `${d.article_number} (${d.code_name}): ${d.content.substring(0, 500)}`),
        top_n: topN,
        return_documents: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[RERANK] Cohere API error:', error);
      return documents.slice(0, topN);
    }

    const data = await response.json();

    // Reorder documents based on Cohere ranking
    const rerankedDocs = data.results.map((result: { index: number; relevance_score: number }) => ({
      ...documents[result.index],
      similarity: result.relevance_score
    }));

    console.log('[RERANK] Reranked order:', rerankedDocs.map((d: LawArticleSource) => `${d.article_number} (${d.similarity.toFixed(3)})`));

    return rerankedDocs;
  } catch (error) {
    console.error('[RERANK] Exception:', error);
    return documents.slice(0, topN);
  }
}

function buildSystemPrompt(
  sources: LawArticleSource[],
  jurisprudence: CourtDecisionSource[],
  casPratiqueDetection: CasPratiqueDetection = "none",
  analysis?: QuestionAnalysis
): string {
  const hasArticles = sources.length > 0;
  const hasJurisprudence = jurisprudence.length > 0;

  if (!hasArticles && !hasJurisprudence) {
    return `Tu es Nomo, un assistant juridique pour les étudiants en droit français.

Je n'ai pas trouvé de sources juridiques pertinentes pour cette question.

COMPORTEMENT :
- Pour les salutations → réponds naturellement et brièvement
- Pour les questions juridiques → dis "Je n'ai pas trouvé cette information dans mes sources juridiques. Essayez de reformuler votre question ou d'être plus précis."
- N'invente JAMAIS d'articles, d'arrêts ou de concepts juridiques`;
  }

  const articlesText = hasArticles
    ? sources
        .map((s) => `[${s.article_number} - ${s.code_name}]\n${s.content}`)
        .join("\n\n")
    : "Aucun article pertinent trouve.";

  const jurisprudenceText = hasJurisprudence
    ? jurisprudence
        .map(
          (j) =>
            `- Arret ${j.case_number} (${j.jurisdiction}${j.chambre ? `, ${j.chambre}` : ""}, ${j.date_decision}):\n  ${j.summary}`
        )
        .join("\n\n")
    : "Aucune jurisprudence pertinente trouvee.";

  const casPratiqueMethodology = casPratiqueDetection === "explicit" ? `

MÉTHODOLOGIE CAS PRATIQUE :

L'utilisateur a explicitement demandé un cas pratique. Tu DOIS structurer ta réponse selon le syllogisme juridique :

1. **Qualification des faits**
   - Situe le cas en une phrase (thème juridique : droit du travail, droit des contrats, etc.)
   - Résume les faits pertinents en utilisant des termes juridiques
   - Qualifie les parties (ex: "le locataire", "l'employeur", "le vendeur") plutôt que les noms propres

2. **Problème de droit**
   - Formule la question juridique de manière générale et abstraite
   - Ne te réfère pas aux faits spécifiques de l'espèce
   - Exemple : "Un salarié peut-il..." plutôt que "M. Dupont peut-il..."

3. **Règle de droit applicable (Majeure)**
   - Cite les articles de loi pertinents en les reformulant (ne recopie pas)
   - Mentionne la jurisprudence applicable avec les arrêts fournis
   - Respecte la hiérarchie des normes (Constitution > Traités > Lois > Règlements)

4. **Application aux faits (Mineure)**
   - Commence par "En l'espèce..."
   - Applique concrètement la règle de droit aux faits qualifiés
   - Si plusieurs solutions sont possibles, envisage-les toutes et argumente

5. **Conclusion**
   - Énonce les conséquences juridiques en quelques lignes
   - Réponds directement à la question posée

${CRFPA_COMPLEMENT}
` : '';

  // Build analysis section if provided
  const analysisSection = analysis && (analysis.domaines.length > 0 || analysis.problematiques.length > 0) ? `

ANALYSE PRÉALABLE DU SUJET :
${analysis.domaines.length > 0 ? `- Domaines de droit : ${analysis.domaines.join(', ')}` : ''}
${analysis.problematiques.length > 0 ? `- Problématiques identifiées : ${analysis.problematiques.join(', ')}` : ''}
${analysis.qualificationsRecherchees.length > 0 ? `- Qualifications à examiner : ${analysis.qualificationsRecherchees.join(', ')}` : ''}
` : '';

  // Build verification section for problematiques
  const verificationSection = analysis && analysis.problematiques?.length ? `

⚠️ VÉRIFICATION OBLIGATOIRE :
Tu as identifié les problématiques suivantes. Tu DOIS traiter CHACUNE d'elles dans ta réponse avec une partie dédiée :
${analysis.problematiques?.map((p, i) => `${i+1}. ${p}`).join('\n') || 'Aucune problématique identifiée'}

AVANT de conclure, vérifie que tu as bien traité TOUTES les ${analysis.problematiques?.length || 0} problématiques ci-dessus.
Si une problématique n'a pas de partie dédiée, tu DOIS l'ajouter.
` : '';

  if (verificationSection) {
    console.log('[PROMPT] Injection vérification', analysis.problematiques?.length || 0, 'problématiques');
  }

  // Build structure section if it's a cas pratique
  const structureSection = analysis && analysis.isCasPratique && analysis.structureRecommandee ? `

===== STRUCTURE OBLIGATOIRE =====

${analysis.structureRecommandee}

Pour chaque point :
- MAJEURE : Cite l'article précis + énonce le principe juridique
- MINEURE : Commence par "En l'espèce..." + applique aux faits
- CONCLUSION : Tranche clairement

Tu DOIS respecter cette structure. Utilise I. II. III. pour les grandes parties.

=================================
` : '';

  // Build legal rules section
  const legalRulesSection = `

RÈGLES JURIDIQUES IMPORTANTES À RESPECTER :

Ces règles sont des principes établis que tu DOIS appliquer correctement :

=== DROIT DES SOCIÉTÉS ===

TRANSFORMATION DE SOCIÉTÉ :
- La transformation entraîne la CESSATION AUTOMATIQUE des mandats (pas une révocation)
- Une cessation ≠ une révocation → les clauses d'indemnité de révocation ne s'appliquent PAS
- Exception : si la transformation vise UNIQUEMENT à évincer un dirigeant = révocation déguisée

ACTION SOCIALE UT SINGULI :
- Possible UNIQUEMENT contre les dirigeants de DROIT (pas de fait)
- Contre un dirigeant de FAIT → il faut passer par un mandataire ad hoc ou l'action sociale ut universi
- Nécessite de mettre en cause la société (mandataire ad hoc si conflit d'intérêts)

ACTION INDIVIDUELLE DE L'ASSOCIÉ :
- Fondement : Art. 1240 Code civil
- Condition STRICTE : préjudice PERSONNEL et DISTINCT du préjudice social
- La perte de valeur des titres, l'absence de dividendes = préjudice INDIRECT → action vouée à l'échec

DEVOIR DE LOYAUTÉ :
- Le DIRIGEANT a un devoir de loyauté envers la société
- L'ACTIONNAIRE n'a PAS de devoir de loyauté (arrêt Vilgrain, Cass. com. 27 févr. 1996)
- Exception : clause statutaire ou actes de concurrence déloyale caractérisés

INSUFFISANCE D'ACTIF (Art. L. 651-2) :
- Action possible contre dirigeants de droit ET de fait
- Requiert : faute de gestion + contribution à l'insuffisance d'actif
- Seul le liquidateur peut l'exercer (pas l'associé directement)

=== CESSION DE FONDS DE COMMERCE ===

ÉLÉMENTS DU FONDS :
- Éléments corporels : matériel, outillage, marchandises/stock
- Éléments incorporels : clientèle, nom commercial, droit au bail, contrats spéciaux
- Le stock est inclus SAUF stipulation contraire expresse dans l'acte

TRANSMISSION DES CONTRATS :
- Principe : les contrats NE SE TRANSMETTENT PAS automatiquement
- Exceptions légales : bail commercial (Art. L. 145-16), contrats de travail (Art. L. 1224-1)
- Le contrat de distribution N'EST PAS transmis automatiquement, même essentiel à l'activité
- Exception : clause contractuelle EXPRESSE de transmission au cessionnaire

=== CONVENTIONS RÉGLEMENTÉES ===

PROCÉDURE :
- Autorisation PRÉALABLE du conseil d'administration
- Approbation ULTÉRIEURE par l'assemblée générale

SANCTIONS :
- Défaut d'autorisation préalable → nullité possible SI préjudice pour la société
- Défaut d'approbation AG seule → convention reste valable (sauf fraude), responsabilité des dirigeants

RAISON D'ÊTRE (Art. 1835 C. civ.) :
- Sa violation ne permet PAS d'annuler un contrat avec un tiers
- Seule sanction : responsabilité civile des dirigeants pour faute de gestion
`;

  return `Tu es Nomo, un assistant juridique expert pour les etudiants en droit francais niveau CRFPA.
${analysisSection}${verificationSection}${structureSection}${legalRulesSection}
⚠️ INSTRUCTION OBLIGATOIRE : Tu DOIS utiliser les sources ci-dessous pour repondre. Des sources pertinentes ont ete trouvees pour cette question.

REGLES STRICTES :
1. Tu DOIS construire ta reponse a partir des articles et/ou arrets fournis
2. Ne dis JAMAIS "je n'ai pas trouve" si des sources sont presentes ci-dessous
3. Cite explicitement les articles et arrets dans ta reponse
4. N'invente rien, utilise uniquement le contenu des sources
${analysis && analysis.problematiques.length > 0 ? `5. Analyse CHAQUE problématique identifiée ci-dessus` : ''}
${casPratiqueMethodology}
FORMAT DE REPONSE :
- ${casPratiqueDetection === "explicit" ? 'SUIS STRICTEMENT la méthodologie du cas pratique ci-dessus (5 étapes obligatoires)' : casPratiqueDetection === "uncertain" ? 'Demande d\'abord le format souhaité, puis donne une réponse courte' : 'Commence par repondre directement a la question'}
- Cite les articles : "L'article X du Code Y dispose que..."
- Sois pedagogique et clair pour un etudiant en droit

⚠️ CITATION DE JURISPRUDENCE OBLIGATOIRE :
- Tu DOIS citer CHAQUE arrêt fourni dans la section JURISPRUDENCE ci-dessous
- Format obligatoire : "La Cour de cassation, chambre [X], dans un arrêt du [date] (n°[numéro]), a jugé que..."
- Intègre les arrêts dans la MAJEURE de chaque partie concernée
- Un cas pratique SANS jurisprudence = copie incomplète
- Si 2 arrêts sont fournis, tu DOIS en citer au moins 2 dans ta réponse
- Ne les ignore JAMAIS, même s'ils te semblent secondaires

📚 EXPLOITATION DES ARTICLES :
- Tu as reçu une liste d'articles TRIÉS PAR PERTINENCE
- Les 10 premiers articles sont les PLUS IMPORTANTS - utilise-les en priorité
- Pour chaque problématique identifiée, cite AU MOINS 2 articles différents
- Ne te limite pas à un seul article par partie - croise les articles complémentaires
- Articles souvent complémentaires :
  * Formation contrat : 1113 + 1114 + 1118 + 1127-3 (si contrat électronique)
  * Responsabilité : 1240 + 1241
  * Inexécution : 1217 + 1218 + 1231-5
  * Paiement : 1342 + 1343

ARTICLES DE LOI :
${articlesText}

JURISPRUDENCE :
${jurisprudenceText}

Reponds maintenant en utilisant ces sources.`;
}

async function createSupabaseClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

// Admin emails with unlimited free access
const ADMIN_EMAILS = [
  "sachalbs@outlook.com",
  "scipbeylouni@gmail.com",
];

export async function POST(request: NextRequest) {
  try {
    const { message, conversationId } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseClient();

    // Get current user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check subscription status
    const isAdmin = ADMIN_EMAILS.includes(user.email || "");

    if (!isAdmin) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("message_count, is_subscribed")
        .eq("id", user.id)
        .single();

      const messageCount = profile?.message_count || 0;
      const isSubscribed = profile?.is_subscribed || false;

      if (messageCount >= 10 && !isSubscribed) {
        return NextResponse.json(
          {
            error: "subscription_required",
            message: "Vous avez atteint la limite de 10 messages gratuits. Abonnez-vous pour continuer.",
            messageCount,
          },
          { status: 402 }
        );
      }
    }

    let currentConversationId = conversationId;

    // Create new conversation if needed
    if (!currentConversationId) {
      const { data: conversation, error: convError } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: message.slice(0, 50) + (message.length > 50 ? "..." : ""),
        })
        .select()
        .single();

      if (convError) {
        console.error("Error creating conversation:", convError);
        return NextResponse.json(
          { error: "Failed to create conversation" },
          { status: 500 }
        );
      }

      currentConversationId = conversation.id;
    }

    // Save user message
    const { error: userMsgError } = await supabase.from("messages").insert({
      conversation_id: currentConversationId,
      role: "user",
      content: message,
    });

    if (userMsgError) {
      console.error("Error saving user message:", userMsgError);
      return NextResponse.json(
        { error: "Failed to save message" },
        { status: 500 }
      );
    }

    // EARLY EXIT: Simple confirmation messages (no RAG needed)
    const isSimpleConfirmation = /^(ok|okay|d'accord|merci|thanks|parfait|super|cool|bien|oui|non|entendu|compris|alright|got it|top|nickel|g[eé]nial|ah|oh|h+m+)[\s.,!?]*$/i.test(message.trim());

    if (isSimpleConfirmation) {
      console.log("[SIMPLE CONFIRMATION] Detected, skipping RAG");

      // Get conversation history for context
      const { data: history } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", currentConversationId)
        .order("created_at", { ascending: true })
        .limit(10);

      const conversationHistory = history?.slice(-6) || [];

      // Simple conversational response
      const anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: "Tu es Nomo, un assistant juridique pour étudiants en droit français. Réponds de manière naturelle et brève aux messages de confirmation ou remerciements. Sois amical mais concis.",
        messages: [
          ...conversationHistory.map((msg) => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
          { role: "user" as const, content: message },
        ],
      });

      const assistantMessage = response.content[0].type === "text" ? response.content[0].text : "";

      // Save assistant message
      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: assistantMessage,
        sources: [],
      });

      // Update conversation timestamp
      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", currentConversationId);

      // Increment message count
      await supabase.rpc("increment_message_count", { user_id: user.id });

      return NextResponse.json({
        response: assistantMessage,
        conversationId: currentConversationId,
        sources: [],
      });
    }

    // Check if this is definitely NOT a legal question
    // New approach: BLACKLIST instead of WHITELIST
    // By default, we search for all questions EXCEPT obvious non-legal ones
    const isNonLegal = isDefinitelyNotLegal(message);

    // ============================================================================
    // STEP 0: ANALYZE QUESTION WITH CLAUDE (NEW!)
    // ============================================================================
    console.log('[STEP 0] Analyzing question with Claude...');
    const analysis = await analyzeQuestion(message);
    console.log('[ANALYSIS] Domaines:', analysis.domaines);
    console.log('[ANALYSIS] Problématiques:', analysis.problematiques);
    console.log('[ANALYSIS] Articles connus:', analysis.articlesConnus);
    console.log('[ANALYSIS] Codes à rechercher:', analysis.codesARechercher);
    console.log('[ANALYSIS] Is legal question:', analysis.isLegalQuestion);
    console.log('[ANALYSIS] Est un cas pratique:', analysis.isCasPratique);
    console.log('[ANALYSIS] Structure recommandée:', analysis.structureRecommandee);

    // Déterminer la limite d'articles selon la complexité (défini ici pour être accessible partout)
    const isCasPratique = analysis?.isCasPratique || message.toLowerCase().includes('cas pratique');
    const maxArticles = isCasPratique ? 20 : 12;
    console.log('[ANALYSIS] Max articles:', maxArticles, `(cas pratique: ${isCasPratique})`);

    // If Claude determined it's not a legal question, skip RAG
    if (!analysis.isLegalQuestion && isNonLegal) {
      console.log('[ANALYSIS] Not a legal question, skipping RAG');

      const anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const response = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: "Tu es Nomo, un assistant juridique pour étudiants en droit français. Réponds de manière naturelle et brève aux questions non-juridiques.",
        messages: [{ role: "user", content: message }],
      });

      const assistantMessage = response.content[0].type === "text" ? response.content[0].text : "";

      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: assistantMessage,
        sources: [],
      });

      await supabase
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", currentConversationId);

      await supabase.rpc("increment_message_count", { user_id: user.id });

      return NextResponse.json({
        response: assistantMessage,
        conversationId: currentConversationId,
        sources: [],
      });
    }

    // Generate embedding and search for all potentially legal questions
    let sources: LawArticleSource[] = [];
    let jurisprudence: CourtDecisionSource[] = [];
    let exactMatchArticles: LawArticleSource[] = [];
    // Helper function to clean article numbers with code suffixes
    function cleanArticleNumber(articleRef: string): { number: string, codeHint?: string } {
      // First remove common prefixes like "Art.", "Article"
      let cleaned = articleRef.replace(/^(Art\.?|Article)\s*/i, '').trim();

      // Patterns for code suffixes
      const patterns = [
        { suffix: / CSI$/i, code: 'Code de la sécurité intérieure' },
        { suffix: / CC$/i, code: 'Code civil' },
        { suffix: / C\.?\s?civ\.?$/i, code: 'Code civil' },
        { suffix: / CP$/i, code: 'Code pénal' },
        { suffix: / C\.?\s?pén\.?$/i, code: 'Code pénal' },
        { suffix: / C\.?\s?com\.?$/i, code: 'Code de commerce' },
        { suffix: / C\.?\s?trav\.?$/i, code: 'Code du travail' },
        { suffix: / CPP$/i, code: 'Code de procédure pénale' },
        { suffix: / CPC$/i, code: 'Code de procédure civile' },
      ];

      for (const pattern of patterns) {
        if (pattern.suffix.test(cleaned)) {
          return {
            number: cleaned.replace(pattern.suffix, '').trim(),
            codeHint: pattern.code
          };
        }
      }

      return { number: cleaned };
    }

    let articlesFromAnalysis: LawArticleSource[] = [];
    let searchTimedOut = false;

    if (!isNonLegal) {
      // STEP 0.5: Search for articles identified by Claude analysis (HIGHEST PRIORITY)
      if (analysis.articlesConnus && analysis.articlesConnus.length > 0) {
        console.log('[STEP 0.5] Searching for articles identified by Claude:', analysis.articlesConnus);

        for (const articleRef of analysis.articlesConnus.slice(0, 20)) {
          try {
            // Clean article reference and extract code hint
            const cleaned = cleanArticleNumber(articleRef);
            console.log(`[STEP 0.5] Cleaned "${articleRef}" → number: "${cleaned.number}", code: ${cleaned.codeHint || 'none'}`);

            // Determine target code: use code hint from article reference, or from analysis
            let targetCode: string | null = cleaned.codeHint || null;
            if (!targetCode && analysis.codesARechercher.length > 0) {
              // Use first code from analysis as fallback hint
              targetCode = analysis.codesARechercher[0];
            }

            let query = supabase
              .from('law_articles')
              .select('id, code_name, article_number, content, source_url')
              .ilike('article_number', `%${cleaned.number}%`);

            if (targetCode) {
              query = query.eq('code_name', targetCode);
            }

            const { data, error } = await query.limit(2);

            if (error) {
              console.error(`[STEP 0.5] Error searching for ${articleRef}:`, error);
            } else if (data && data.length > 0) {
              articlesFromAnalysis.push(...data.map((a: any) => ({
                ...a,
                similarity: 1.0, // Highest priority
              })));
              console.log(`[STEP 0.5] Found ${data.length} articles for ${articleRef}:`, data.map((a: any) => a.article_number));
            } else {
              console.log(`[STEP 0.5] No articles found for ${articleRef}`);
            }
          } catch (error) {
            console.error(`[STEP 0.5] Exception searching for ${articleRef}:`, error);
          }
        }

        console.log(`[STEP 0.5] Total articles found from analysis: ${articlesFromAnalysis.length}`);
      }

      // STEP 1: Exact search (separate from vector search)
      const articleNumber = extractArticleNumber(message);
      const codeName = extractCodeName(message);

      if (articleNumber) {
        console.log(`[EXACT MATCH] Detected article number: ${articleNumber}`);
        if (codeName) {
          console.log(`[EXACT MATCH] Detected code: ${codeName}`);
        }

        try {
          // Direct search for exact article number
          let query = supabase
            .from("law_articles")
            .select("id, code_name, article_number, content, source_url")
            .ilike("article_number", `%${articleNumber}%`);

          // Filter by code name if detected
          if (codeName) {
            query = query.eq("code_name", codeName);
          }

          const { data: exactMatches, error: exactError } = await query.limit(5);

          if (exactError) {
            console.error("[EXACT MATCH] Error:", exactError);
          } else if (exactMatches && exactMatches.length > 0) {
            exactMatchArticles = exactMatches.map(a => ({
              ...a,
              similarity: 1.0, // Perfect match
            }));
            console.log(`[EXACT MATCH] Found ${exactMatchArticles.length} articles:`,
                       exactMatchArticles.map(a => a.article_number));
          } else {
            console.log("[EXACT MATCH] No exact matches found");
          }
        } catch (error) {
          console.error("[EXACT MATCH] Exception:", error);
        }
      }

      // ===== STEP 1.5: CONCEPT MATCH DÉSACTIVÉ =====
      // RAISON: Trop de faux positifs sur les mots courts et ambigus
      // Exemples de faux positifs: 'terme' → CDD, 'fonds' → abus de confiance, 'SA' → société anonyme
      // HyDE + Multi-Query + Vector Search sont suffisants pour la découverte d'articles
      // Les articles critiques sont maintenant détectés via triggers explicites dans STEP 0
      let conceptMatchArticles: LawArticleSource[] = [];
      console.log('[CONCEPT MATCH] DÉSACTIVÉ - HyDE + Multi-Query suffisent');
      // ===== FIN DÉSACTIVATION CONCEPT MATCH =====

      // STEP 2: Vector search (with timeout handling and fallback)
      let vectorArticles: LawArticleSource[] = [];
      let highScoreArticles: LawArticleSource[] = []; // FIX 7: Articles haute similarité à protéger
      let vectorSearchFailed = false;

      try {
        const startTime = Date.now();

        const queryEmbedding = await generateEmbedding(message);
        console.log(`[RAG] Embedding generated in ${Date.now() - startTime}ms`);

        // Use codes from Claude analysis, fallback to old detection
        const relevantCodes = analysis.codesARechercher && analysis.codesARechercher.length > 0
          ? analysis.codesARechercher
          : detectRelevantCodes(message);

        if (relevantCodes) {
          console.log(`[VECTOR SEARCH] Filtering on ${relevantCodes.length} codes (from ${analysis.codesARechercher.length > 0 ? 'Claude analysis' : 'keyword detection'}): ${relevantCodes.join(', ')}`);
        } else {
          console.log('[VECTOR SEARCH] No filter → searching all codes');
        }

        // MULTI-QUERY RAG + HyDE: Generate variations and search in parallel
        let multiQueryResults: LawArticleSource[] = [];
        try {
          const anthropicClient = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
          });

          // Generate query variations
          const queryVariations = await generateQueryVariations(message, anthropicClient);

          // Generate hypothetical answer for HyDE
          const hypotheticalAnswer = await generateHypotheticalAnswer(message, anthropicClient);

          // Build query list: original + variations + hypothetical (if generated)
          const allQueries = [message, ...queryVariations];
          if (hypotheticalAnswer) {
            allQueries.push(hypotheticalAnswer);
          }

          console.log(`[MULTI-QUERY + HyDE] Searching with ${allQueries.length} queries (1 original + ${queryVariations.length} variations${hypotheticalAnswer ? ' + 1 HyDE' : ''})`);

          // Execute searches in parallel for each variation
          const multiQuerySearches = await Promise.all(
            allQueries.map(async (query, index) => {
              try {
                // Determine if this is the HyDE query
                const isHyDE = hypotheticalAnswer && index === allQueries.length - 1;

                // Generate embedding for this variation
                const variantEmbedding = await generateEmbedding(query);

                // Use hybridSearch for each variation
                const results = await hybridSearch(supabase, query, variantEmbedding, relevantCodes, 15);

                if (isHyDE) {
                  console.log(`[HyDE] Found ${results.length} articles from hypothetical search`);
                }

                return results;
              } catch (error) {
                console.error(`[MULTI-QUERY] Error searching for "${query.slice(0, 50)}...":`, error);
                return [];
              }
            })
          );

          // Fuse results with RRF
          multiQueryResults = reciprocalRankFusion(multiQuerySearches);
          console.log(`[MULTI-QUERY + HyDE] Fused ${multiQueryResults.length} unique articles from ${allQueries.length} queries`);
        } catch (error) {
          console.error('[MULTI-QUERY + HyDE] Error in multi-query pipeline:', error);
          // Continue without multi-query results
        }

        // Search for similar law articles using hybrid search (ILIKE + Vector + RRF)
        const searchStartTime = Date.now();
        const articlesPromise = ragFusion(
          supabase,
          message,
          queryEmbedding,
          relevantCodes,
          10
        );

        // Search for similar court decisions
        console.log('[VECTOR DEBUG] Calling match_court_decisions with threshold: 0.2');
        const jurisprudencePromise = supabase.rpc("match_court_decisions", {
          query_embedding: queryEmbedding,
          match_threshold: 0.2,
          match_count: 2,
        });

        // Dynamic timeout based on code filtering
        // - With filter (specific codes) → 5s (hybrid search takes more time)
        // - Without filter (all codes) → 10s (comprehensive search)
        const timeoutMs = relevantCodes ? 5000 : 10000;
        console.log(`[HYBRID SEARCH] Timeout set to ${timeoutMs}ms (filtered: ${!!relevantCodes})`);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("SEARCH_TIMEOUT")), timeoutMs);
        });

        // Run both searches in parallel with timeout
        const [articlesResult, jurisprudenceResult] = await Promise.race([
          Promise.all([articlesPromise, jurisprudencePromise]),
          timeoutPromise,
        ]);

        const searchDuration = Date.now() - searchStartTime;
        console.log(`[RAG] Hybrid search completed in ${searchDuration}ms`);

        // Store hybrid search results (hybridSearch returns array directly)
        const ragFusionResults = articlesResult || [];
        console.log(`[RAG] RAG-Fusion found: ${ragFusionResults.length}`, ragFusionResults.map(s => s.article_number));

        // Combine Multi-Query results with RAG-Fusion results using RRF
        if (multiQueryResults.length > 0) {
          const combinedResults = reciprocalRankFusion([multiQueryResults, ragFusionResults]);
          vectorArticles = combinedResults;
          console.log(`[RAG] Combined Multi-Query (${multiQueryResults.length}) + RAG-Fusion (${ragFusionResults.length}) = ${vectorArticles.length} unique articles`);
        } else {
          vectorArticles = ragFusionResults;
          console.log(`[RAG] Using RAG-Fusion results only: ${vectorArticles.length}`);
        }

        // FIX 7: Protéger les articles avec haute similarité
        const HIGH_SCORE_THRESHOLD = 0.75;
        highScoreArticles = vectorArticles
          .filter((a: any) => (a.similarity || a.score || 0) >= HIGH_SCORE_THRESHOLD)
          .slice(0, 5);

        if (highScoreArticles.length > 0) {
          console.log('[VECTOR] Articles haute similarité protégés:',
            highScoreArticles.map((a: any) => a.article_number + ' (' + ((a.similarity || a.score) * 100).toFixed(0) + '%)').join(', ')
          );
        }

        // Store jurisprudence results
        console.log('[VECTOR DEBUG] Jurisprudence raw response error:', jurisprudenceResult.error);
        console.log('[VECTOR DEBUG] Jurisprudence raw response data length:', jurisprudenceResult.data?.length);
        console.log('[VECTOR DEBUG] Jurisprudence raw response sample:', JSON.stringify(jurisprudenceResult.data?.slice(0, 2)));

        if (jurisprudenceResult.error) {
          console.error("[RAG] Error searching court decisions:", jurisprudenceResult.error);
        } else {
          let allJurisprudence: CourtDecisionSource[] = jurisprudenceResult.data || [];
          console.log(`[RAG] Jurisprudence found (before filtering): ${allJurisprudence.length}`, allJurisprudence.map((j: CourtDecisionSource) => j.case_number));

          // Filter by relevant chambers based on analysis
          const chambresRelevantes = analysis.domaines.length > 0 ? getChambresFromDomaines(analysis.domaines) : [];

          if (chambresRelevantes.length > 0) {
            console.log('[JURISPRUDENCE] Filtrage sur chambres:', chambresRelevantes);
            jurisprudence = allJurisprudence.filter(j =>
              chambresRelevantes.some(chambre =>
                j.chambre?.toLowerCase().includes(chambre.toLowerCase())
              )
            );
            console.log(`[JURISPRUDENCE] Après filtrage: ${jurisprudence.length}/${allJurisprudence.length} arrêts conservés`);
          } else {
            jurisprudence = allJurisprudence;
            console.log('[JURISPRUDENCE] Pas de filtrage (domaines non identifiés)');
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg === "SEARCH_TIMEOUT") {
          console.error("[RAG] Vector search timed out after 5s");
          searchTimedOut = true;
          vectorSearchFailed = true;
        } else {
          console.error("[RAG] Error in vector search pipeline:", errorMsg);
          vectorSearchFailed = true;
        }
      }

      // STEP 3: FALLBACK to keyword search if vector search failed or timed out
      if (vectorSearchFailed && vectorArticles.length === 0) {
        console.log("[FALLBACK] Vector search failed, trying keyword search...");
        const keywords = extractKeywords(message);
        const keywordArticles = await keywordSearch(supabase, message, keywords, codeName, 3);

        if (keywordArticles.length > 0) {
          console.log(`[FALLBACK] Keyword search found ${keywordArticles.length} articles`);
          vectorArticles = keywordArticles;
        } else {
          console.log("[FALLBACK] Keyword search found no articles");
        }
      }

      // STEP 4: Combine all sources with priority ordering
      // NEW Priority order: analysis articles (1.0) > exact matches (1.0) > concept matches (0.98) > vector/keyword (variable)
      const allArticleNumbers = new Set<string>();

      // 0. Add articles from Claude analysis FIRST (absolute highest priority)
      const dedupedAnalysisArticles = articlesFromAnalysis.filter(a => {
        const key = `${a.code_name}:${a.article_number}`;
        if (allArticleNumbers.has(key)) return false;
        allArticleNumbers.add(key);
        return true;
      });

      // 1. Add exact matches (second highest priority)
      const dedupedExactMatches = exactMatchArticles.filter(a => {
        const key = `${a.code_name}:${a.article_number}`;
        if (allArticleNumbers.has(key)) return false;
        allArticleNumbers.add(key);
        return true;
      });

      // 2. Add concept matches (third priority)
      const dedupedConceptMatches = conceptMatchArticles.filter(a => {
        const key = `${a.code_name}:${a.article_number}`;
        if (allArticleNumbers.has(key)) return false;
        allArticleNumbers.add(key);
        return true;
      });

      // 3. Add vector/keyword results (lowest priority)
      const dedupedVectorArticles = vectorArticles.filter(a => {
        const key = `${a.code_name}:${a.article_number}`;
        if (allArticleNumbers.has(key)) return false;
        allArticleNumbers.add(key);
        return true;
      });

      // Séparer les articles de l'analyse Claude (ceux-ci sont PROTÉGÉS et jamais éliminés par le rerank)
      const analysisArticleIds = new Set(dedupedAnalysisArticles.map(a => a.id));

      // Articles à rerank : seulement les articles NON issus de l'analyse Claude
      const articlesToRerank = [
        ...dedupedExactMatches,
        ...dedupedConceptMatches,
        ...dedupedVectorArticles
      ].filter(a => !analysisArticleIds.has(a.id));

      console.log('[RERANK] Articles from Claude analysis (protected):', dedupedAnalysisArticles.length);
      console.log('[RERANK] Articles to rerank:', articlesToRerank.length);

      // FIX 5: Enrichir le contexte pour le reranker avec domaines et problématiques
      const rerankContext = [
        'Domaine juridique: ' + (analysis?.domaines?.join(', ') || 'droit civil'),
        'Problématiques: ' + (analysis?.problematiques?.slice(0, 3).join('; ') || ''),
        'Question: ' + message.slice(0, 400)
      ].join('. ');
      console.log('[RERANK] Query enrichie:', rerankContext.slice(0, 100) + '...');

      // Rerank seulement les articles non-protégés
      let rerankedOthers: typeof articlesToRerank = [];
      if (articlesToRerank.length > 0) {
        rerankedOthers = await rerankWithCohere(rerankContext, articlesToRerank, 6);
      }

      // FILTRE DE PERTINENCE THÉMATIQUE après reranking
      if (rerankedOthers.length > 0) {
        const isCivilDomain = analysis?.domaines.some(d => d.toLowerCase().includes('civil'));
        const isContractRelated = analysis?.problematiques.some(p => {
          const pLower = p.toLowerCase();
          return pLower.includes('contrat') ||
                 pLower.includes('obligation') ||
                 pLower.includes('clause pénale') ||
                 pLower.includes('force majeure');
        });

        if (isCivilDomain && isContractRelated) {
          console.log('[FILTER] Applying thematic filter: civil domain + contract problematic');

          const offTopicKeywords = ['empreintes génétiques', 'adn', 'identification', 'prélèvement'];
          const beforeFilterCount = rerankedOthers.length;

          rerankedOthers = rerankedOthers.filter(article => {
            const contentLower = article.content?.toLowerCase() || '';
            const isOffTopic = offTopicKeywords.some(keyword => contentLower.includes(keyword));

            if (isOffTopic) {
              console.log(`[FILTER] Article ${article.article_number} exclu (hors-sujet: contient ${offTopicKeywords.find(k => contentLower.includes(k))})`);
              return false;
            }
            return true;
          });

          const excludedCount = beforeFilterCount - rerankedOthers.length;
          if (excludedCount > 0) {
            console.log(`[FILTER] ${excludedCount} article(s) exclu(s) pour hors-sujet`);
          }
        }
      }

      // Combiner : articles de l'analyse Claude en premier, puis haute similarité, puis reranked
      // Note: maxArticles est défini plus haut (15 pour cas pratiques, 10 sinon)
      // FIX 7: Ajouter les articles haute similarité pour s'assurer qu'ils sont inclus même si mal classés par reranker
      const dedupedHighScore = highScoreArticles.filter(hs =>
        !dedupedAnalysisArticles.some(da => da.id === hs.id)
      );

      let finalArticles = [
        ...dedupedAnalysisArticles.slice(0, 15),  // Les articles que Claude a identifiés pour CE cas spécifique
        ...dedupedHighScore.slice(0, 3),  // Articles haute similarité protégés
        ...rerankedOthers.slice(0, 5)
      ].slice(0, maxArticles);

      if (dedupedHighScore.length > 0) {
        console.log('[FINAL] Protected high-score articles added:', dedupedHighScore.slice(0, 3).map(a => a.article_number).join(', '));
      }

      // FIX 3: Filtrer les articles hors-sujet (servitudes, succession, tutelle, etc.)
      const EXCLUSIONS_CONTRATS = [
        '682', '683', '684', '685', '686', '687', '688', '689', '690', '691', '692',
        '810', '811', '812', '813', '814', '815', '816', '817', '818', '819', '820', '821', '822',
        '427', '428', '429', '430', '431', '432', '433', '434', '435', '436', '437', '438', '439', '440',
        '467', '468', '469', '470', '471', '472', '473', '474', '475', '476', '477', '478', '479', '480',
        '535', '536', '537', '538', '539', '540', '541', '542', '543'
      ];

      const domaines = analysis?.domaines || [];
      if (domaines.some((d: string) => ['contrats', 'civil', 'obligations', 'responsabilité'].includes(d.toLowerCase()))) {
        const beforeCount = finalArticles.length;
        finalArticles = finalArticles.filter((a: any) => {
          const num = (a.article_number || '').replace('Article ', '').split(' ')[0];
          return !EXCLUSIONS_CONTRATS.some(ex => num === ex || num.startsWith(ex + '-'));
        });
        if (beforeCount !== finalArticles.length) {
          console.log('[FILTER HORS-SUJET] Exclu', beforeCount - finalArticles.length, 'articles (succession/servitudes/tutelle)');
        }
      }

      sources = finalArticles;

      console.log('[FINAL] Protected analysis articles:', Math.min(dedupedAnalysisArticles.length, 10));
      console.log('[FINAL] Reranked articles added:', Math.min(rerankedOthers.length, 5));
      console.log('[FINAL] Max articles limit:', maxArticles);
      console.log('[FINAL] Total articles:', sources.length);
      if (sources.length > 0) {
        console.log('[FINAL] Final order:', sources.map(s => `${s.article_number} (${s.code_name}, sim: ${s.similarity.toFixed(2)})`));
      }

      // STEP 5: RÈGLES SPÉCIALES - Articles fondamentaux
      const lowerMsg = message.toLowerCase();

      // Define special rules: [condition check, code name, article numbers, rule name]
      const specialRules: Array<{
        check: (msg: string) => boolean;
        codeName: string;
        articles: string[];
        ruleName: string;
      }> = [
        // Prescription pénale
        {
          check: (msg) => msg.includes('prescription') &&
            (msg.includes('pénal') || msg.includes('penal') ||
             msg.includes('délit') || msg.includes('delit') ||
             msg.includes('crime') || msg.includes('infraction') ||
             msg.includes('abus')),
          codeName: 'Code de procédure pénale',
          articles: ['Article 7', 'Article 8', 'Article 9'],
          ruleName: 'Prescription pénale'
        },
        // Responsabilité civile délictuelle
        {
          check: (msg) => msg.includes('responsabilité délictuelle') ||
            msg.includes('responsabilite delictuelle') ||
            (msg.includes('responsabilité civile') || msg.includes('responsabilite civile')),
          codeName: 'Code civil',
          articles: ['Article 1240', 'Article 1241', 'Article 1242'],
          ruleName: 'Responsabilité civile délictuelle'
        },
        // Divorce
        {
          check: (msg) => msg.includes('divorce'),
          codeName: 'Code civil',
          articles: ['Article 229', 'Article 229-1', 'Article 229-2', 'Article 229-3'],
          ruleName: 'Divorce'
        },
        // Abus de confiance
        {
          check: (msg) => msg.includes('abus de confiance'),
          codeName: 'Code pénal',
          articles: ['Article 314-1'],
          ruleName: 'Abus de confiance'
        },
        // Prescription civile
        {
          check: (msg) => msg.includes('prescription') &&
            (msg.includes('civil') || msg.includes('civile')),
          codeName: 'Code civil',
          articles: ['Article 2224'],
          ruleName: 'Prescription civile'
        },
        // Contrat de travail
        {
          check: (msg) => msg.includes('cdi') ||
            msg.includes('contrat de travail'),
          codeName: 'Code du travail',
          articles: ['Article L1221-1', 'Article L1221-2'],
          ruleName: 'Contrat de travail'
        }
      ];

      // Apply all matching special rules
      for (const rule of specialRules) {
        if (rule.check(lowerMsg)) {
          console.log(`[SPECIAL RULE] ${rule.ruleName} detected - adding ${rule.articles.join(', ')}`);

          const { data: ruleArticles } = await supabase
            .from('law_articles')
            .select('id, code_name, article_number, content, source_url')
            .eq('code_name', rule.codeName)
            .in('article_number', rule.articles);

          if (ruleArticles && ruleArticles.length > 0) {
            const ruleSources: LawArticleSource[] = ruleArticles.map((a: any) => ({
              ...a,
              similarity: 0.95
            }));

            // Remove these articles if already present (to avoid duplicates)
            const ruleNumbers = new Set(ruleSources.map(r => r.article_number));
            sources = sources.filter(s => !ruleNumbers.has(s.article_number));

            // Ajouter en PREMIER (priorité maximale), utiliser maxArticles au lieu de limite fixe
            sources = [...ruleSources, ...sources].slice(0, maxArticles);
            console.log(`[SPECIAL RULE] Added ${ruleArticles.length} articles for ${rule.ruleName} in priority`);
          }
        }
      }

      console.log(`[FINAL] Total sources: ${sources.length} articles, ${jurisprudence.length} jurisprudence`);
      if (sources.length > 0) {
        console.log(`[FINAL] Articles:`, sources.map(s => `${s.article_number} (sim: ${s.similarity.toFixed(2)})`));
      }
    } // End of if (needsRag)

    // Only return timeout error if NO sources found after all fallbacks
    if (searchTimedOut && sources.length === 0 && jurisprudence.length === 0) {
      console.log("[TIMEOUT] No sources available after all fallback attempts");
      // Save timeout message to conversation
      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: "Je n'ai pas trouvé de sources juridiques pertinentes pour cette question. Essayez de reformuler ou d'être plus précis.",
        sources: [],
      });

      return NextResponse.json({
        response: "Je n'ai pas trouvé de sources juridiques pertinentes pour cette question. Essayez de reformuler ou d'être plus précis.",
        conversationId: currentConversationId,
        sources: [],
      });
    } else if (searchTimedOut) {
      console.log(`[TIMEOUT] Vector search timed out, but continuing with ${sources.length} sources from fallback`);
    }

    // Get conversation history for context
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", currentConversationId)
      .order("created_at", { ascending: true });

    // Detect if this is a case study (cas pratique)
    const casPratiqueDetection = detectCasPratique(message);
    if (casPratiqueDetection === "explicit") {
      console.log("[CAS PRATIQUE] Explicit - will use structured methodology");
    } else if (casPratiqueDetection === "uncertain") {
      console.log("[CAS PRATIQUE] Uncertain - will ask user for preference");
    }

    // Classify penal infraction type if relevant
    let penalInfractionType: 'INTENTIONNELLE' | 'NON_INTENTIONNELLE' | 'TENTATIVE' | null = null;
    let penalPlan = '';
    if (analysis?.domaines.includes('pénal')) {
      penalInfractionType = await classifyPenalInfraction(message);
      console.log('[PENAL] Type d\'infraction détecté:', penalInfractionType);

      // Select the appropriate plan based on infraction type
      if (penalInfractionType === 'INTENTIONNELLE') {
        penalPlan = PLAN_INTENTIONNELLE;
        console.log('[PENAL] Plan injecté: PLAN_INTENTIONNELLE');
      } else if (penalInfractionType === 'NON_INTENTIONNELLE') {
        penalPlan = PLAN_NON_INTENTIONNELLE;
        console.log('[PENAL] Plan injecté: PLAN_NON_INTENTIONNELLE');
      } else if (penalInfractionType === 'TENTATIVE') {
        penalPlan = PLAN_TENTATIVE;
        console.log('[PENAL] Plan injecté: PLAN_TENTATIVE');
      }
    }

    // Build system prompt with dynamic content (including Claude's analysis)
    let systemPrompt = buildSystemPrompt(sources, jurisprudence, casPratiqueDetection, analysis);

    // Inject penal plan if applicable
    if (penalPlan) {
      systemPrompt += '\n\n' + penalPlan;
    }

    // Detect and inject aggravating circumstances for penal cases
    if (analysis?.domaines.includes('pénal')) {
      const aggravatingFactors = detectAggravatingCircumstances(message);
      if (aggravatingFactors.length > 0) {
        console.log('[PENAL] Circonstances aggravantes détectées:', aggravatingFactors);
        systemPrompt += '\n\n⚠️ CIRCONSTANCES AGGRAVANTES DÉTECTÉES DANS L\'ÉNONCÉ :\n';
        systemPrompt += aggravatingFactors.map(f => '- ' + f).join('\n');
        systemPrompt += '\n\nTu DOIS analyser ces circonstances aggravantes dans ta réponse et citer les articles correspondants.';
      } else {
        console.log('[PENAL] Aucune circonstance aggravante détectée');
      }

      // Inject strict penal rules
      systemPrompt += '\n\n' + REGLES_PENALES;
      console.log('[PENAL] Règles strictes injectées');
    }

    // DEBUG: Log system prompt
    console.log("\n========== SYSTEM PROMPT DEBUG ==========");
    console.log(`Sources count: ${sources.length}`);
    console.log(`Jurisprudence count: ${jurisprudence.length}`);
    if (sources.length > 0) {
      console.log("\n--- Articles in prompt ---");
      sources.forEach((s, idx) => {
        console.log(`\n[${idx + 1}] ${s.article_number} - ${s.code_name}`);
        console.log(`Content length: ${s.content?.length || 0} chars`);
        console.log(`Content preview: ${s.content?.substring(0, 150) || 'NO CONTENT'}...`);
        console.log(`Similarity: ${s.similarity}`);
      });
    }
    console.log("\n--- Full System Prompt ---");
    console.log(systemPrompt);
    console.log("========== END SYSTEM PROMPT DEBUG ==========\n");

    // =========================================================================
    // CLAUDE API WITH CITATIONS
    // =========================================================================

    // Prepare documents for Claude Citations API
    const documentsForClaude: Anthropic.DocumentBlockParam[] = sources.map((article) => ({
      type: "document" as const,
      source: {
        type: "text" as const,
        media_type: "text/plain" as const,
        data: `${article.article_number} (${article.code_name}):\n${article.content}`,
      },
      title: article.article_number,
      context: article.code_name,
    }));

    // Add jurisprudence as documents
    const jurisprudenceForClaude: Anthropic.DocumentBlockParam[] = jurisprudence.map((j) => ({
      type: "document" as const,
      source: {
        type: "text" as const,
        media_type: "text/plain" as const,
        data: `${j.jurisdiction}${j.chambre ? ` - ${j.chambre}` : ""}, ${j.date_decision}, n°${j.case_number}:\n${j.summary}`,
      },
      title: `${j.jurisdiction} ${j.case_number}`,
      context: `Décision du ${j.date_decision}`,
    }));

    const allDocuments = [...documentsForClaude, ...jurisprudenceForClaude];
    console.log("[CITATIONS] Nombre de documents fournis à Claude:", allDocuments.length);

    // Build conversation history for multi-turn
    const historyMessages: Anthropic.MessageParam[] = (history || []).map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    // Call Claude API with Citations
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    let assistantMessage = "";

    try {
      console.log("[RESPONSE] Generating final response with max_tokens: 8192 and citations");

      // Build the user message with documents + question
      const userContentBlocks: Anthropic.ContentBlockParam[] = [
        // First, all documents
        ...allDocuments,
        // Then the question
        {
          type: "text" as const,
          text: message,
        },
      ];

      const claudeResponse = await anthropic.beta.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        betas: ["pdfs-2024-09-25"],
        system: systemPrompt,
        messages: [
          // Include history if any
          ...historyMessages,
          // Current user message with documents
          {
            role: "user" as const,
            content: userContentBlocks,
          },
        ],
      });

      // Extract text from response
      for (const block of claudeResponse.content) {
        if (block.type === "text") {
          assistantMessage += block.text;
        }
      }
    } catch (error) {
      console.error("Claude API error:", error);
      return NextResponse.json(
        { error: "Failed to get AI response" },
        { status: 500 }
      );
    }

    // =========================================================================
    // EXTRACT CITED ARTICLES FROM RESPONSE TEXT
    // =========================================================================

    // Extract ALL article numbers cited in the response text
    const extractCitedArticles = (text: string): { number: string; code?: string }[] => {
      const cited: { number: string; code?: string }[] = [];

      // Pattern 1: "article 1240 du Code civil", "article L. 225-1 du Code de commerce"
      const fullPattern = /articles?\s+(L\.?\s*)?(\d+(?:-\d+)*(?:-\d+)?)\s+(?:et\s+(L\.?\s*)?(\d+(?:-\d+)*))?(?:\s+du\s+(Code\s+\w+))?/gi;

      // Pattern 2: Simple "article 1240", "art. 1241"
      const simplePattern = /(?:article|art\.?)\s+(L\.?\s*)?(\d+(?:-\d+)*)/gi;

      // Pattern 3: "articles 1240, 1241 et 1242"
      const listPattern = /articles?\s+(\d+(?:-\d+)*(?:\s*,\s*\d+(?:-\d+)*)*(?:\s+et\s+\d+(?:-\d+)*)?)/gi;

      // Extract from full pattern (with code name)
      for (const match of text.matchAll(fullPattern)) {
        const prefix = match[1] || '';
        const num = prefix + match[2];
        const code = match[5];
        cited.push({ number: num.replace(/\s+/g, ''), code });

        // Also capture second article if "et" present
        if (match[4]) {
          const prefix2 = match[3] || '';
          cited.push({ number: prefix2 + match[4], code });
        }
      }

      // Extract from simple pattern
      for (const match of text.matchAll(simplePattern)) {
        const prefix = match[1] || '';
        const num = prefix + match[2];
        if (!cited.some(c => c.number === num.replace(/\s+/g, ''))) {
          cited.push({ number: num.replace(/\s+/g, '') });
        }
      }

      // Extract from list pattern (1240, 1241 et 1242)
      for (const match of text.matchAll(listPattern)) {
        const numbers = match[1].split(/[,\s]+et\s+|,\s*/).map(n => n.trim()).filter(n => n);
        for (const num of numbers) {
          if (!cited.some(c => c.number === num)) {
            cited.push({ number: num });
          }
        }
      }

      console.log('[CITATIONS] Extracted from text:', cited.map(c => c.code ? `${c.number} (${c.code})` : c.number));
      return cited;
    };

    const citedArticles = extractCitedArticles(assistantMessage);
    console.log("[CITATIONS] Articles extraits du texte:", citedArticles.map(c => c.number));

    // Match sources with cited articles - be more strict
    const matchedSources = sources.filter((article) => {
      const articleNum = article.article_number
        .replace(/^Article\s*/i, '')
        .replace(/\s+/g, '')
        .trim();

      return citedArticles.some((cited) => {
        // Exact match or partial match
        const citedNum = cited.number.replace(/\s+/g, '');
        const matches = articleNum === citedNum ||
                       articleNum.includes(citedNum) ||
                       citedNum.includes(articleNum);

        // If code is specified, also check code name
        if (matches && cited.code) {
          return article.code_name.toLowerCase().includes(cited.code.toLowerCase().replace('code ', ''));
        }

        return matches;
      });
    });

    // Matcher jurisprudence (si le numéro d'arrêt est mentionné)
    const matchedJurisprudence = jurisprudence.filter((j) => {
      return assistantMessage.includes(j.case_number);
    });

    console.log(
      "[CITATIONS] Sources matchées:",
      matchedSources.length,
      "articles,",
      matchedJurisprudence.length,
      "arrêts"
    );

    // Utiliser les sources matchées, ou fallback sur RAG
    let sourcesToUse: LawArticleSource[];
    let jurisprudenceToUse: CourtDecisionSource[];

    if (matchedSources.length > 0) {
      sourcesToUse = matchedSources;
      jurisprudenceToUse = matchedJurisprudence.length > 0 ? matchedJurisprudence : jurisprudence.slice(0, 2);
    } else {
      console.log("[CITATIONS] Aucun match, utilisation des sources RAG par défaut");
      sourcesToUse = sources.slice(0, maxArticles);
      jurisprudenceToUse = jurisprudence.slice(0, 2);
    }

    // Format sources for response (articles + jurisprudence)
    // Deduplicate articles by article_number
    const seenArticles = new Set<string>();
    const articleSources = sourcesToUse
      .filter((s) => {
        if (seenArticles.has(s.article_number)) return false;
        seenArticles.add(s.article_number);
        return true;
      })
      .slice(0, 3) // Max 3 articles
      .map((s) => ({
        type: "article" as const,
        article_number: s.article_number,
        code_name: s.code_name,
        source_url: s.source_url,
      }));

    // Deduplicate jurisprudence by case_number (using filtered jurisprudenceToUse)
    const seenCases = new Set<string>();
    const jurisprudenceSources = jurisprudenceToUse
      .filter((j) => {
        if (seenCases.has(j.case_number)) return false;
        seenCases.add(j.case_number);
        return true;
      })
      .slice(0, 2) // Max 2 arrêts
      .map((j) => ({
        type: "jurisprudence" as const,
        article_number: `Arret ${j.case_number}`,
        code_name: `${j.jurisdiction}${j.chambre ? ` - ${j.chambre}` : ""}`,
        source_url: j.source_url,
      }));

    // Total max 5 sources
    const sourcesForResponse = [...articleSources, ...jurisprudenceSources].slice(0, 5);

    // Debug: log sources being sent
    console.log("[CHAT API] Sources for response:", JSON.stringify(sourcesForResponse, null, 2));

    // Save assistant message with sources
    const { error: assistantMsgError } = await supabase.from("messages").insert({
      conversation_id: currentConversationId,
      role: "assistant",
      content: assistantMessage,
      sources: sourcesForResponse,
    });

    if (assistantMsgError) {
      console.error("Error saving assistant message:", assistantMsgError);
    }

    // Update conversation timestamp
    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", currentConversationId);

    // Increment message count for subscription tracking
    await supabase.rpc("increment_message_count", { user_id: user.id });

    return NextResponse.json({
      response: assistantMessage,
      conversationId: currentConversationId,
      sources: sourcesForResponse,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
