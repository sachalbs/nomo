import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { generateEmbedding } from "@/lib/embeddings";

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

function buildSystemPrompt(
  sources: LawArticleSource[],
  jurisprudence: CourtDecisionSource[]
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

  return `Tu es Nomo, un assistant juridique pour les etudiants en droit francais.

⚠️ INSTRUCTION OBLIGATOIRE : Tu DOIS utiliser les sources ci-dessous pour repondre. Des sources pertinentes ont ete trouvees pour cette question.

REGLES STRICTES :
1. Tu DOIS construire ta reponse a partir des articles et/ou arrets fournis
2. Ne dis JAMAIS "je n'ai pas trouve" si des sources sont presentes ci-dessous
3. Cite explicitement les articles et arrets dans ta reponse
4. N'invente rien, utilise uniquement le contenu des sources

REGLES DE REPONSE :
- Reponds en 150-250 mots maximum sauf demande explicite de details
- Cite uniquement les 2-3 sources les plus pertinentes parmi celles fournies, pas toutes
- Structure ta reponse : definition → conditions → effets
- Priorise les sources dans cet ordre :
  1. Article de loi directement applicable (Code civil, penal, travail, commerce)
  2. Arret de principe (Assemblee pleniere, Chambre mixte)
  3. Jurisprudence recente confirmant la regle
- Si plusieurs arrets disent la meme chose, cite seulement le plus ancien (arret fondateur)
- Si aucune source n'est vraiment pertinente pour la question, dis-le clairement au lieu d'inventer

FORMAT DE REPONSE :
- Commence par repondre directement a la question
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

    // Generate embedding for the user's question
    let sources: LawArticleSource[] = [];
    let jurisprudence: CourtDecisionSource[] = [];
    let searchTimedOut = false;

    try {
      const startTime = Date.now();
      const queryEmbedding = await generateEmbedding(message);
      console.log(`[RAG] Embedding generated in ${Date.now() - startTime}ms`);

      // Search for similar law articles with timeout
      const searchStartTime = Date.now();
      const articlesPromise = supabase.rpc("match_law_articles", {
        query_embedding: queryEmbedding,
        match_threshold: 0.55,
        match_count: 8,
      });

      // Search for similar court decisions
      const jurisprudencePromise = supabase.rpc("match_court_decisions", {
        query_embedding: queryEmbedding,
        match_threshold: 0.45,
        match_count: 6,
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
      console.log(`[RAG] Search completed in ${searchDuration}ms`);

      if (articlesResult.error) {
        console.error("Error searching law articles:", articlesResult.error);
      } else {
        sources = articlesResult.data || [];
        console.log(`[RAG] Articles trouves: ${sources.length}`, sources.map(s => s.article_number));
      }

      if (jurisprudenceResult.error) {
        console.error("Error searching court decisions:", jurisprudenceResult.error);
      } else {
        jurisprudence = jurisprudenceResult.data || [];
        console.log(`[RAG] Jurisprudence trouvee: ${jurisprudence.length}`, jurisprudence.map(j => j.case_number));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg === "SEARCH_TIMEOUT") {
        console.error("[RAG] Search timed out after 30s");
        searchTimedOut = true;
      } else {
        console.error("Error in RAG pipeline:", errorMsg);
      }
    }

    // If search timed out, return user-friendly error
    if (searchTimedOut) {
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
    }

    // Get conversation history for context
    const { data: history } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", currentConversationId)
      .order("created_at", { ascending: true });

    // Build messages array for Mistral with dynamic system prompt
    const systemPrompt = buildSystemPrompt(sources, jurisprudence);
    const messages = [
      { role: "system", content: systemPrompt },
      ...(history || []).map((msg) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })),
    ];

    // Call Mistral AI
    const mistralResponse = await fetch(
      "https://api.mistral.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mistral-small-latest",
          messages,
        }),
      }
    );

    if (!mistralResponse.ok) {
      console.error("Mistral API error:", await mistralResponse.text());
      return NextResponse.json(
        { error: "Failed to get AI response" },
        { status: 500 }
      );
    }

    const mistralData = await mistralResponse.json();
    const assistantMessage = mistralData.choices[0]?.message?.content || "";

    // Format sources for response (articles + jurisprudence)
    const articleSources = sources.map((s) => ({
      type: "article" as const,
      article_number: s.article_number,
      code_name: s.code_name,
      source_url: s.source_url,
    }));

    const jurisprudenceSources = jurisprudence.map((j) => ({
      type: "jurisprudence" as const,
      article_number: `Arret ${j.case_number}`,
      code_name: `${j.jurisdiction}${j.chambre ? ` - ${j.chambre}` : ""}`,
      source_url: j.source_url,
    }));

    const sourcesForResponse = [...articleSources, ...jurisprudenceSources];

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
