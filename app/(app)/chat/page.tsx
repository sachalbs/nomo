"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Source {
  article_number: string;
  code_name: string;
  source_url: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  created_at: string;
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  // Load conversation from URL param
  useEffect(() => {
    const convId = searchParams.get("id");
    if (convId) {
      setConversationId(convId);
      loadMessages(convId);
    } else {
      setConversationId(null);
      setMessages([]);
    }
  }, [searchParams]);

  const loadMessages = async (convId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setIsLoading(true);

    // Optimistically add user message
    const tempUserMsg: Message = {
      id: "temp-user",
      role: "user",
      content: userMessage,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send message");
      }

      // Update conversation ID if new conversation was created
      if (!conversationId && data.conversationId) {
        setConversationId(data.conversationId);
        router.replace(`/chat?id=${data.conversationId}`);
        // Dispatch event to refresh sidebar
        window.dispatchEvent(new Event("conversationCreated"));
      }

      // Add assistant message with sources
      const assistantMsg: Message = {
        id: "temp-assistant-" + Date.now(),
        role: "assistant",
        content: data.response,
        sources: data.sources,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error) {
      console.error("Error sending message:", error);
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== "temp-user"));
    } finally {
      setIsLoading(false);
    }
  };

  const isEmpty = messages.length === 0 && !isLoading;

  return (
    <div className="h-full flex flex-col">
      {isEmpty ? (
        // Empty state
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-[768px] px-4">
            <h1 className="font-serif text-[32px] text-text mb-3">
              Pose ta question juridique
            </h1>
            <p className="text-text-secondary">
              Jurisprudence, articles de loi, cas pratiques...
            </p>
          </div>
        </div>
      ) : (
        // Messages area
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[768px] mx-auto px-4 py-6 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={`max-w-[85%] ${msg.role === "user" ? "" : "space-y-3"}`}>
                  <div
                    className={`px-4 py-3 rounded-lg ${
                      msg.role === "user"
                        ? "bg-surface text-text"
                        : "bg-white border border-border text-text"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  {/* Sources for assistant messages */}
                  {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {msg.sources.map((source, index) => (
                        <a
                          key={index}
                          href={source.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-[13px] text-text-secondary hover:text-text hover:border-text-secondary transition-colors"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          {source.article_number}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-border px-4 py-3 rounded-lg">
                  <p className="text-text-secondary">Nomo reflechit...</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4 flex justify-center">
        <form onSubmit={handleSubmit} className="w-full max-w-[768px]">
          <div className="bg-surface border border-border rounded-lg flex items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Rechercher une jurisprudence, comprendre un arret..."
              rows={1}
              disabled={isLoading}
              className="flex-1 bg-transparent px-4 py-3 resize-none outline-none text-text placeholder:text-text-secondary disabled:opacity-50"
              style={{ minHeight: "48px", maxHeight: "200px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="m-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg p-2 transition-colors"
              aria-label="Envoyer"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
