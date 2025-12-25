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

function buildSystemPrompt(sources: LawArticleSource[]): string {
  if (sources.length === 0) {
    return `Tu es Nomo, un assistant juridique pour les étudiants en droit français.

Je n'ai pas trouvé de sources juridiques pertinentes pour cette question.

COMPORTEMENT :
- Pour les salutations → réponds naturellement et brièvement
- Pour les questions juridiques → dis "Je n'ai pas trouvé cette information dans mes sources juridiques. Essayez de reformuler votre question ou d'être plus précis."
- N'invente JAMAIS d'articles, d'arrêts ou de concepts juridiques`;
  }

  const sourcesText = sources
    .map((s) => `[${s.article_number} - ${s.code_name}]\n${s.content}`)
    .join("\n\n");

  return `Tu es Nomo, un assistant juridique pour les étudiants en droit français.

⚠️ RÈGLE ABSOLUE : Tu ne peux répondre QU'en utilisant les SOURCES ci-dessous. Tu n'as AUCUNE autre connaissance.

COMPORTEMENT :
- Si les sources contiennent l'information → réponds en citant les articles exacts
- Si les sources NE contiennent PAS l'information → dis "Je n'ai pas trouvé cette information dans mes sources juridiques. Essayez de reformuler votre question."
- N'invente JAMAIS d'articles, d'arrêts ou de concepts juridiques
- Ne complète JAMAIS avec des connaissances générales

FORMAT DE RÉPONSE :
- Cite toujours l'article (ex: "L'article 1130 du Code civil dispose que...")
- Sois pédagogique et clair
- Reste concis (pas de listes interminables)

SOURCES DISPONIBLES :
${sourcesText}

Si aucune source n'est pertinente ci-dessus, réponds que tu n'as pas trouvé l'information.`;
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
    let searchTimedOut = false;

    try {
      const startTime = Date.now();
      const queryEmbedding = await generateEmbedding(message);
      console.log(`[RAG] Embedding generated in ${Date.now() - startTime}ms`);

      // Search for similar law articles with timeout
      const searchStartTime = Date.now();
      const searchPromise = supabase.rpc("match_law_articles", {
        query_embedding: queryEmbedding,
        match_threshold: 0.6,
        match_count: 3,
      });

      // 30 second timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("SEARCH_TIMEOUT")), 30000);
      });

      const { data: matchedSources, error: searchError } = await Promise.race([
        searchPromise,
        timeoutPromise,
      ]);

      const searchDuration = Date.now() - searchStartTime;
      console.log(`[RAG] Search completed in ${searchDuration}ms`);

      if (searchError) {
        console.error("Error searching law articles:", searchError);
      } else {
        sources = matchedSources || [];
        console.log(`[RAG] Sources trouvées: ${sources.length}`, sources.map(s => s.article_number));
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
    const systemPrompt = buildSystemPrompt(sources);
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

    // Format sources for response
    const sourcesForResponse = sources.map((s) => ({
      article_number: s.article_number,
      code_name: s.code_name,
      source_url: s.source_url,
    }));

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
