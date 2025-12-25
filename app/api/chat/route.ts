import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding } from "@/lib/embeddings";
import Anthropic from "@anthropic-ai/sdk";

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

// Keywords that indicate a legal question requiring RAG search
const LEGAL_KEYWORDS = [
  // General legal terms
  "article", "loi", "code", "droit", "juridique", "legal", "justice",
  "tribunal", "cour", "juge", "avocat", "jurisprudence",
  // Contract law
  "contrat", "obligation", "clause", "consentement", "nullite", "resiliation",
  "inexecution", "dommages", "interets", "creancier", "debiteur",
  // Tort law
  "responsabilite", "faute", "prejudice", "reparation", "indemnisation",
  "negligence", "dommage",
  // Criminal law
  "penal", "crime", "delit", "infraction", "peine", "amende", "prison",
  // Labor law
  "travail", "licenciement", "cdi", "cdd", "salarie", "employeur",
  "contrat de travail", "preavis", "indemnite",
  // Commercial law
  "commerce", "commercial", "societe", "entreprise", "faillite",
  // Civil law
  "civil", "mariage", "divorce", "heritage", "succession", "propriete",
  // Court decisions
  "arret", "cassation", "appel", "pourvoi", "chronopost", "pleniere",
  // Specific codes
  "code civil", "code penal", "code du travail", "code de commerce",
  // Legal concepts
  "prescription", "forclusion", "caducite", "vice", "erreur", "dol",
  "violence", "lesion", "capacite", "incapacite",
];

function isLegalQuestion(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check if message is too short (likely a greeting)
  if (message.trim().length < 15) {
    // Unless it contains a clear legal reference like "article 1240"
    if (!/article\s*\d+/i.test(message)) {
      return false;
    }
  }

  // Check for legal keywords
  return LEGAL_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
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

    // Check if this is a legal question that needs RAG
    // TEMPORAIREMENT DÉSACTIVÉ - toutes les questions passent par le RAG
    // const needsRag = isLegalQuestion(message);
    const needsRag = true;
    console.log(`[RAG] Question juridique detectee: ${needsRag} (filtre desactive)`);

    // Generate embedding and search only for legal questions
    let sources: LawArticleSource[] = [];
    let jurisprudence: CourtDecisionSource[] = [];
    let exactMatchArticles: LawArticleSource[] = [];
    let searchTimedOut = false;

    if (needsRag) {
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

      // STEP 2: Vector search (with timeout handling)
      try {
        const startTime = Date.now();

        const queryEmbedding = await generateEmbedding(message);
        console.log(`[RAG] Embedding generated in ${Date.now() - startTime}ms`);

        // Search for similar law articles with timeout
        const searchStartTime = Date.now();
        const articlesPromise = supabase.rpc("match_law_articles", {
          query_embedding: queryEmbedding,
          match_threshold: 0.45,
          match_count: 3,
        });

        // Search for similar court decisions
        const jurisprudencePromise = supabase.rpc("match_court_decisions", {
          query_embedding: queryEmbedding,
          match_threshold: 0.45,
          match_count: 2,
        });

        // 30 second timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("SEARCH_TIMEOUT")), 30000);
        });

        // Run both searches in parallel with timeout
        const [articlesResult, jurisprudenceResult] = await Promise.race([
          Promise.all([articlesPromise, jurisprudencePromise]),
          timeoutPromise,
        ]);

      const searchDuration = Date.now() - searchStartTime;
      console.log(`[RAG] Vector search completed in ${searchDuration}ms`);

      // Store vector results
      let vectorArticles: LawArticleSource[] = [];
      if (articlesResult.error) {
        console.error("[RAG] Error searching law articles:", articlesResult.error);
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

      // Combine exact matches with vector results
      if (exactMatchArticles.length > 0) {
        // Remove duplicates: filter out vector results that are already in exact matches
        const exactArticleNumbers = new Set(exactMatchArticles.map(a => a.article_number));
        const uniqueVectorArticles = vectorArticles.filter(
          v => !exactArticleNumbers.has(v.article_number)
        );

        // Exact matches first, then vector results
        sources = [...exactMatchArticles, ...uniqueVectorArticles].slice(0, 5);
        console.log(`[COMBINED] Total articles: ${sources.length} (${exactMatchArticles.length} exact + ${uniqueVectorArticles.length} vector)`);
      } else {
        sources = vectorArticles;
      }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg === "SEARCH_TIMEOUT") {
          console.error("[RAG] Vector search timed out after 30s");
          searchTimedOut = true;
        } else {
          console.error("[RAG] Error in vector search pipeline:", errorMsg);
        }
      }

      // STEP 3: Combine results even if vector search failed
      // If we have exact matches but vector search failed/timed out, use exact matches
      if (exactMatchArticles.length > 0 && sources.length === 0) {
        sources = exactMatchArticles;
        console.log(`[FALLBACK] Using ${sources.length} exact match articles (vector search failed)`);
      }

      console.log(`[FINAL] Total sources: ${sources.length} articles, ${jurisprudence.length} jurisprudence`);
      if (sources.length > 0) {
        console.log(`[FINAL] Articles:`, sources.map(s => `${s.article_number} (sim: ${s.similarity.toFixed(2)})`));
      }
    } // End of if (needsRag)

    // If search timed out BUT we have exact matches, continue anyway
    if (searchTimedOut && sources.length === 0 && jurisprudence.length === 0) {
      console.log("[TIMEOUT] No sources available, returning error");
      // Save timeout message to conversation
      await supabase.from("messages").insert({
        conversation_id: currentConversationId,
        role: "assistant",
        content: "La recherche prend trop de temps. Essayez une question plus précise.",
        sources: [],
      });

      return NextResponse.json({
        response: "La recherche prend trop de temps. Essayez une question plus précise.",
        conversationId: currentConversationId,
        sources: [],
      });
    } else if (searchTimedOut) {
      console.log(`[TIMEOUT] Vector search timed out, but continuing with ${sources.length} exact matches`);
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
