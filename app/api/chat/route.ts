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

function buildSystemPrompt(
  sources: LawArticleSource[],
  jurisprudence: CourtDecisionSource[],
  casPratiqueDetection: CasPratiqueDetection = "none"
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

  return `Tu es Nomo, un assistant juridique pour les etudiants en droit francais.

⚠️ INSTRUCTION OBLIGATOIRE : Tu DOIS utiliser les sources ci-dessous pour repondre. Des sources pertinentes ont ete trouvees pour cette question.

REGLES STRICTES :
1. Tu DOIS construire ta reponse a partir des articles et/ou arrets fournis
2. Ne dis JAMAIS "je n'ai pas trouve" si des sources sont presentes ci-dessous
3. Cite explicitement les articles et arrets dans ta reponse
4. N'invente rien, utilise uniquement le contenu des sources
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

    // Generate embedding and search for all potentially legal questions
    let sources: LawArticleSource[] = [];
    let jurisprudence: CourtDecisionSource[] = [];
    let exactMatchArticles: LawArticleSource[] = [];
    let searchTimedOut = false;

    if (!isNonLegal) {
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

        // Detect relevant codes for optimized search
        const relevantCodes = detectRelevantCodes(message);

        if (relevantCodes) {
          console.log(`[VECTOR SEARCH] Filtering on ${relevantCodes.length} codes: ${relevantCodes.join(', ')}`);
        } else {
          console.log('[VECTOR SEARCH] No filter → searching all codes');
        }

        // Search for similar law articles with timeout and code filtering
        const searchStartTime = Date.now();
        const articlesPromise = supabase.rpc("match_law_articles_filtered", {
          query_embedding: queryEmbedding,
          match_threshold: 0.4,
          match_count: 5,
          filter_codes: relevantCodes  // NULL = tous les codes, sinon filtre sur les codes détectés
        });

        // Search for similar court decisions
        const jurisprudencePromise = supabase.rpc("match_court_decisions", {
          query_embedding: queryEmbedding,
          match_threshold: 0.45,
          match_count: 2,
        });

        // Dynamic timeout based on code filtering
        // - With filter (specific codes) → 3s (fast search)
        // - Without filter (all codes) → 8s (comprehensive search)
        const timeoutMs = relevantCodes ? 3000 : 8000;
        console.log(`[VECTOR SEARCH] Timeout set to ${timeoutMs}ms (filtered: ${!!relevantCodes})`);

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("SEARCH_TIMEOUT")), timeoutMs);
        });

        // Run both searches in parallel with timeout
        const [articlesResult, jurisprudenceResult] = await Promise.race([
          Promise.all([articlesPromise, jurisprudencePromise]),
          timeoutPromise,
        ]);

        const searchDuration = Date.now() - searchStartTime;
        console.log(`[RAG] Vector search completed in ${searchDuration}ms`);

        // Store vector results
        if (articlesResult.error) {
          console.error("[RAG] Error searching law articles:", articlesResult.error);
          vectorSearchFailed = true;
        } else {
          vectorArticles = articlesResult.data || [];
          console.log(`[RAG] Vector search found: ${vectorArticles.length}`, vectorArticles.map(s => s.article_number));
        }

        // Store jurisprudence results
        if (jurisprudenceResult.error) {
          console.error("[RAG] Error searching court decisions:", jurisprudenceResult.error);
        } else {
          jurisprudence = jurisprudenceResult.data || [];
          console.log(`[RAG] Jurisprudence found: ${jurisprudence.length}`, jurisprudence.map(j => j.case_number));
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

      // STEP 4: Combine exact matches, concept matches, and vector/keyword results
      // Priority order: exact matches (1.0) > concept matches (0.98) > vector/keyword (variable)
      const allArticleNumbers = new Set<string>();

      // 1. Add exact matches first (highest priority)
      const dedupedExactMatches = exactMatchArticles.filter(a => {
        const key = `${a.code_name}:${a.article_number}`;
        if (allArticleNumbers.has(key)) return false;
        allArticleNumbers.add(key);
        return true;
      });

      // 2. Add concept matches (second priority)
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

      // Combine all sources with priority ordering
      sources = [
        ...dedupedExactMatches,
        ...dedupedConceptMatches,
        ...dedupedVectorArticles
      ].slice(0, 5);

      console.log(`[COMBINED] Total articles: ${sources.length} (${dedupedExactMatches.length} exact + ${dedupedConceptMatches.length} concept + ${dedupedVectorArticles.length} vector/keyword)`);
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

    // Build system prompt with dynamic content
    const systemPrompt = buildSystemPrompt(sources, jurisprudence, casPratiqueDetection);

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

    // Build messages for Claude (history + current message)
    const claudeMessages = [
      ...(history || []).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    ];

    // Call Claude API
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    let assistantMessage = "";

    try {
      const claudeResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: claudeMessages,
      });

      // Extract text response
      const textContent = claudeResponse.content.find((c) => c.type === "text");
      assistantMessage = textContent?.text || "";
    } catch (error) {
      console.error("Claude API error:", error);
      return NextResponse.json(
        { error: "Failed to get AI response" },
        { status: 500 }
      );
    }

    // Format sources for response (articles + jurisprudence)
    // Deduplicate articles by article_number
    const seenArticles = new Set<string>();
    const articleSources = sources
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

    // Deduplicate jurisprudence by case_number
    const seenCases = new Set<string>();
    const jurisprudenceSources = jurisprudence
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
