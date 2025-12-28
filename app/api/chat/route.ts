import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding } from "@/lib/embeddings";
import Anthropic from "@anthropic-ai/sdk";
import { LEGAL_CONCEPTS } from "@/lib/legal-concepts";

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

function extractArticleNumber(message: string): string | null {
  // Match patterns like "article 108", "Article 1240", "art. 123", "art 456"
  const patterns = [
    /\barticle\s+(\d+(?:[.-]\d+)*)/i,
    /\bart\.?\s+(\d+(?:[.-]\d+)*)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
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

// Extract important keywords from question for fallback search
function extractKeywords(message: string): string[] {
  const lowerMessage = message.toLowerCase();

  // Remove common words (stop words) - including generic legal terms that are too broad
  const stopWords = new Set([
    "le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "à", "a",
    "est", "sont", "peut", "quelle", "quel", "quels", "quelles", "comment",
    "pourquoi", "qui", "que", "quoi", "où", "dans", "sur", "pour", "par",
    "avec", "sans", "sous", "c'est", "cest", "qu'est-ce", "quest-ce",
    "expliquer", "explique", "définir", "définition",
    // Generic terms that match too many articles
    "delai", "delais", "délai", "délais", "quand", "agit", "sont"
  ]);

  // Extract multi-word legal terms (n-grams) - PRIORITY SEARCH
  const multiWordTerms: string[] = [];
  const legalPhrases = [
    // Criminal law - commercial offenses
    /\b(abus de biens sociaux)\b/g,
    /\b(abus de confiance)\b/g,
    /\b(detournement de fonds)\b/g,
    /\b(détournement de fonds)\b/g,
    // Liability concepts
    /\b(responsabilit[eé] civile)\b/g,
    /\b(responsabilit[eé] p[eé]nale)\b/g,
    /\b(responsabilit[eé] contractuelle)\b/g,
    /\b(responsabilit[eé] d[eé]lictuelle)\b/g,
    // Contract law
    /\b(contrat de travail)\b/g,
    /\b(contrat de vente)\b/g,
    /\b(contrat de bail)\b/g,
    /\b(clause abusive)\b/g,
    /\b(clause l[eé]onine)\b/g,
    // Prescription and time limits
    /\b(prescription [a-zàâäéèêëïîôùûüÿæœç]+)\b/g, // "prescription pénale", "prescription civile", etc.
    /\b(d[eé]lai de prescription)\b/g,
    // Other important phrases
    /\b(vice du consentement)\b/g,
    /\b(droit de r[eé]tractation)\b/g,
    /\b(ordre public)\b/g,
    /\b(bonne foi)\b/g,
    /\b(faute lourde)\b/g,
    /\b(force majeure)\b/g,
  ];

  legalPhrases.forEach(pattern => {
    const matches = lowerMessage.match(pattern);
    if (matches) {
      multiWordTerms.push(...matches);
    }
  });

  // Split into words and filter - only keep specific legal terms
  const words = lowerMessage
    .replace(/[^\w\sàâäéèêëïîôùûüÿæœç-]/g, " ") // Keep accents and hyphens
    .split(/\s+/)
    .filter(word => word.length > 4 && !stopWords.has(word)); // Increased min length to 5

  // Combine with priority to multi-word terms
  return Array.from(new Set([...multiWordTerms, ...words])).slice(0, 7); // Increased limit for better matching
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
  const chambres: string[] = [];

  // Criminal law
  if (domaines.some(d => ["pénal", "penal", "procédure pénale", "procedure penale", "criminel"].includes(d.toLowerCase()))) {
    chambres.push("criminelle", "cr", "CRIM", "Crim.", "Chambre criminelle");
  }

  // Civil law
  if (domaines.some(d => ["civil", "obligations", "contrats", "famille", "responsabilité civile", "responsabilite civile"].includes(d.toLowerCase()))) {
    chambres.push("civ1", "civ2", "civ3", "civile", "CIV1", "CIV2", "CIV3", "Civ. 1", "Civ. 2", "Civ. 3", "1re chambre civile", "2e chambre civile", "3e chambre civile");
  }

  // Commercial law
  if (domaines.some(d => ["commercial", "affaires", "sociétés", "societes", "commerce"].includes(d.toLowerCase()))) {
    chambres.push("commerciale", "comm", "COMM", "Com.", "Chambre commerciale");
  }

  // Labor law
  if (domaines.some(d => ["travail", "social"].includes(d.toLowerCase()))) {
    chambres.push("sociale", "soc", "SOC", "Soc.", "Chambre sociale");
  }

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
  const { data: vectorResults, error: vectorError } = await supabase
    .rpc('match_law_articles_filtered', {
      query_embedding: queryEmbedding,
      match_threshold: 0.35,
      match_count: 20,
      filter_codes: filterCodes
    });

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
` : casPratiqueDetection === "uncertain" ? `

DÉTECTION CAS PRATIQUE :

Tu as détecté une situation juridique factuelle, mais ce n'est pas clair si l'utilisateur veut un cas pratique structuré ou une simple explication.

COMMENCE TA RÉPONSE PAR :
"Il semble que tu me présentes une situation juridique concrète. Souhaites-tu que je structure ma réponse sous forme de cas pratique (avec syllogisme juridique : qualification des faits, problème de droit, majeure, mineure, conclusion) ou préfères-tu une explication simple et directe ?"

PUIS donne une réponse courte et directe à la question en utilisant les sources.

` : '';

  // Build analysis section if provided
  const analysisSection = analysis && (analysis.domaines.length > 0 || analysis.problematiques.length > 0) ? `

ANALYSE PRÉALABLE DU SUJET :
${analysis.domaines.length > 0 ? `- Domaines de droit : ${analysis.domaines.join(', ')}` : ''}
${analysis.problematiques.length > 0 ? `- Problématiques identifiées : ${analysis.problematiques.join(', ')}` : ''}
${analysis.qualificationsRecherchees.length > 0 ? `- Qualifications à examiner : ${analysis.qualificationsRecherchees.join(', ')}` : ''}
` : '';

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
${analysisSection}${structureSection}${legalRulesSection}
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
- Cite les arrets : "L'arret [nom] du [date] a juge que..."
- Sois pedagogique et clair pour un etudiant en droit

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
    let articlesFromAnalysis: LawArticleSource[] = [];
    let searchTimedOut = false;

    if (!isNonLegal) {
      // STEP 0.5: Search for articles identified by Claude analysis (HIGHEST PRIORITY)
      if (analysis.articlesConnus && analysis.articlesConnus.length > 0) {
        console.log('[STEP 0.5] Searching for articles identified by Claude:', analysis.articlesConnus);

        for (const articleRef of analysis.articlesConnus.slice(0, 10)) {
          try {
            // Clean article reference (remove "Art.", "article", etc.)
            const cleanNum = articleRef.replace(/^(Art\.?|Article)\s*/i, '').trim();

            // Extract code name if present (e.g., "L435-1 CSI" → code = "Code de la sécurité intérieure")
            let targetCode: string | null = null;
            if (articleRef.includes('CSI')) {
              targetCode = "Code de la sécurité intérieure";
            } else if (analysis.codesARechercher.length > 0) {
              // Use first code from analysis as hint
              targetCode = analysis.codesARechercher[0];
            }

            let query = supabase
              .from('law_articles')
              .select('id, code_name, article_number, content, source_url')
              .ilike('article_number', `%${cleanNum}%`);

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

      // STEP 1.5: CONCEPT MATCH - Search legal concepts index before vector search
      let conceptMatchArticles: LawArticleSource[] = [];
      try {
        const lowerMsg = message.toLowerCase();
        console.log("[CONCEPT MATCH] Analyzing message for legal concepts...");

        // Find matching concepts
        const matchedConcepts: string[] = [];

        for (const [conceptName, conceptData] of Object.entries(LEGAL_CONCEPTS)) {
          // Check if concept name matches
          if (lowerMsg.includes(conceptName.toLowerCase())) {
            matchedConcepts.push(conceptName);
            console.log(`[CONCEPT MATCH] Found concept by name: "${conceptName}"`);
          } else {
            // Check if any keyword matches
            for (const keyword of conceptData.keywords) {
              if (lowerMsg.includes(keyword.toLowerCase())) {
                matchedConcepts.push(conceptName);
                console.log(`[CONCEPT MATCH] Found concept "${conceptName}" via keyword: "${keyword}"`);
                break; // One keyword match is enough
              }
            }
          }
        }

        // Deduplicate matched concepts
        const uniqueConcepts = Array.from(new Set(matchedConcepts));

        if (uniqueConcepts.length > 0) {
          console.log(`[CONCEPT MATCH] Total matched concepts: ${uniqueConcepts.length} - ${uniqueConcepts.join(", ")}`);

          // For each matched concept, fetch articles from database
          for (const conceptName of uniqueConcepts) {
            const conceptData = LEGAL_CONCEPTS[conceptName];

            for (const articleGroup of conceptData.articles) {
              const { code, numbers } = articleGroup;

              // Fetch articles from database
              const { data: conceptArticles, error: conceptError } = await supabase
                .from("law_articles")
                .select("id, code_name, article_number, content, source_url")
                .eq("code_name", code)
                .in("article_number", numbers);

              if (conceptError) {
                console.error(`[CONCEPT MATCH] Error fetching articles for ${conceptName}:`, conceptError);
              } else if (conceptArticles && conceptArticles.length > 0) {
                const conceptSources: LawArticleSource[] = conceptArticles.map((a: any) => ({
                  ...a,
                  similarity: 0.98, // High priority for concept matches
                }));

                conceptMatchArticles.push(...conceptSources);
                console.log(`[CONCEPT MATCH] Added ${conceptArticles.length} articles for concept "${conceptName}" from ${code}:`,
                  conceptArticles.map((a: any) => a.article_number));
              } else {
                console.log(`[CONCEPT MATCH] No articles found for concept "${conceptName}" in ${code}`);
              }
            }
          }

          if (conceptMatchArticles.length > 0) {
            // Deduplicate concept articles by article_number
            const uniqueConceptArticles = Array.from(
              new Map(conceptMatchArticles.map(a => [a.article_number + a.code_name, a])).values()
            );
            conceptMatchArticles = uniqueConceptArticles;
            console.log(`[CONCEPT MATCH] Total unique concept articles: ${conceptMatchArticles.length}`);
          }
        } else {
          console.log("[CONCEPT MATCH] No matching concepts found");
        }
      } catch (error) {
        console.error("[CONCEPT MATCH] Exception:", error);
      }

      // STEP 2: Vector search (with timeout handling and fallback)
      let vectorArticles: LawArticleSource[] = [];
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

        // Search for similar law articles using hybrid search (ILIKE + Vector + RRF)
        const searchStartTime = Date.now();
        const articlesPromise = hybridSearch(
          supabase,
          message,
          queryEmbedding,
          relevantCodes,
          10
        );

        // Search for similar court decisions
        const jurisprudencePromise = supabase.rpc("match_court_decisions", {
          query_embedding: queryEmbedding,
          match_threshold: 0.45,
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
        vectorArticles = articlesResult || [];
        console.log(`[RAG] Hybrid search found: ${vectorArticles.length}`, vectorArticles.map(s => s.article_number));

        // Store jurisprudence results
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

      // Combine all sources
      let combinedSources = [
        ...dedupedAnalysisArticles,
        ...dedupedExactMatches,
        ...dedupedConceptMatches,
        ...dedupedVectorArticles
      ];

      console.log(`[COMBINED] Total articles before rerank: ${combinedSources.length} (${dedupedAnalysisArticles.length} analysis + ${dedupedExactMatches.length} exact + ${dedupedConceptMatches.length} concept + ${dedupedVectorArticles.length} vector/keyword)`);

      // Rerank with Cohere if we have enough documents
      if (combinedSources.length > 3) {
        combinedSources = await rerankWithCohere(message, combinedSources, 5);
      }

      sources = combinedSources.slice(0, 5);

      console.log(`[COMBINED] Total articles after rerank: ${sources.length}`);
      if (sources.length > 0) {
        console.log(`[COMBINED] Final order:`, sources.map(s => `${s.article_number} (${s.code_name}, sim: ${s.similarity.toFixed(2)})`));
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

            // Ajouter en PREMIER (priorité maximale)
            sources = [...ruleSources, ...sources].slice(0, 5);
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

    // Build system prompt with dynamic content (including Claude's analysis)
    const systemPrompt = buildSystemPrompt(sources, jurisprudence, casPratiqueDetection, analysis);

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
      sourcesToUse = sources.slice(0, 5);
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
