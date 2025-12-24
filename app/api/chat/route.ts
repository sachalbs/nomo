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

RÈGLES :
1. Tu n'as pas trouvé de sources juridiques pertinentes pour cette question
2. Indique clairement que tu ne peux pas répondre sans sources fiables
3. Suggère de reformuler la question ou d'être plus précis
4. Ne réponds qu'aux questions juridiques`;
  }

  const sourcesText = sources
    .map((s) => `- ${s.article_number} (${s.code_name}): ${s.content}`)
    .join("\n");

  return `Tu es Nomo, un assistant juridique pour les étudiants en droit français.

SOURCES JURIDIQUES DISPONIBLES :
${sourcesText}

RÈGLES :
1. Réponds UNIQUEMENT en te basant sur les sources ci-dessus
2. Cite TOUJOURS l'article exact (ex: "Article 1240 du Code civil")
3. Si les sources ne permettent pas de répondre, dis-le clairement
4. Explique de manière pédagogique pour un étudiant`;
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
    try {
      const queryEmbedding = await generateEmbedding(message);

      // Search for similar law articles
      const { data: matchedSources, error: searchError } = await supabase.rpc(
        "match_law_articles",
        {
          query_embedding: queryEmbedding,
          match_threshold: 0.5,
          match_count: 5,
        }
      );

      if (searchError) {
        console.error("Error searching law articles:", searchError);
      } else {
        sources = matchedSources || [];
      }
    } catch (embeddingError) {
      console.error("Error generating embedding:", embeddingError);
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

    // Format sources for storage and response
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
