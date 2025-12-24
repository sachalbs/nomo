"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ReactMarkdown from "react-markdown";

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

const suggestions = [
  {
    text: "Qu'est-ce que l'article 1240 ?",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    text: "Expliquer l'arret Chronopost",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M3 12h4l2-9 4 18 2-9h4" />
      </svg>
    ),
  },
  {
    text: "Difference dol et erreur",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    text: "Cas pratique responsabilite",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
];

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.full_name) {
        const firstName = user.user_metadata.full_name.split(" ")[0];
        setUserName(firstName);
      }
    };
    fetchUser();
  }, [supabase.auth]);

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

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

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

      if (!conversationId && data.conversationId) {
        setConversationId(data.conversationId);
        router.replace(`/chat?id=${data.conversationId}`);
        window.dispatchEvent(new Event("conversationCreated"));
      }

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
      setMessages((prev) => prev.filter((m) => m.id !== "temp-user"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
    textareaRef.current?.focus();
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
  };

  const isEmpty = messages.length === 0 && !isLoading;
  const hasInput = input.trim().length > 0;

  return (
    <div className="h-full flex flex-col bg-[#FAFAFA]">
      {isEmpty ? (
        // Empty state - centered input
        <div className="flex-1 flex flex-col items-center justify-center px-4 -mt-8">
          {/* Greeting */}
          <h1 className="font-semibold text-[32px] text-text mb-8">
            {userName ? `Bonjour, ${userName}` : "Pose ta question juridique"}
          </h1>

          {/* Main input */}
          <div className="w-full max-w-[600px]">
            <form onSubmit={handleSubmit}>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleTextareaKeyDown}
                  onInput={handleTextareaInput}
                  placeholder="Pose ta question juridique..."
                  rows={1}
                  disabled={isLoading}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-2xl px-5 py-4 pr-14 resize-none outline-none text-text placeholder:text-[#999] disabled:opacity-50 focus:bg-white focus:border-[#D0D0D0] transition-all min-h-[56px]"
                  style={{ maxHeight: "200px" }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !hasInput}
                  className={`absolute right-3 bottom-3 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    hasInput
                      ? "bg-[#1C1917] hover:bg-[#2C2927] text-white"
                      : "bg-[#E5E5E5] text-[#999] cursor-not-allowed"
                  }`}
                  aria-label="Envoyer"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                </button>
              </div>
            </form>
          </div>

          {/* Suggestions */}
          <div className="flex flex-wrap justify-center gap-2 mt-5 max-w-[600px]">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.text}
                onClick={() => handleSuggestionClick(suggestion.text)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[#EFEFEF] text-[14px] text-[#666] hover:bg-[#F5F5F5] hover:text-text transition-all"
              >
                <span className="text-[#999]">{suggestion.icon}</span>
                {suggestion.text}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // Messages state
        <div className="flex-1 flex flex-col relative">
          <div className="flex-1 overflow-y-auto pb-28">
            <div className="max-w-[768px] mx-auto px-6 py-6 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-message flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className="max-w-[75%] space-y-1">
                    <div
                      className={`px-4 py-3 rounded-2xl ${
                        msg.role === "user"
                          ? "bg-[#F5F5F5] text-text"
                          : "bg-white border border-[#EFEFEF] text-text"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        <div className="prose prose-sm prose-chat max-w-none leading-relaxed">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* Sources for assistant messages */}
                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {msg.sources.map((source, index) => (
                          <a
                            key={index}
                            href={source.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#F5F5F4] border border-[#E7E5E4] rounded-lg text-[13px] text-[#666] hover:text-text hover:border-[#D0D0D0] transition-colors"
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

                    {/* Timestamp */}
                    <p className={`text-[11px] text-[#999] ${msg.role === "user" ? "text-right" : "text-left"} px-1`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="chat-message flex justify-start">
                  <div className="bg-white border border-[#EFEFEF] px-4 py-3 rounded-2xl">
                    <p className="text-[#666] flex items-center gap-1">
                      Nomo reflechit
                      <span className="typing-dots">
                        <span>.</span>
                        <span>.</span>
                        <span>.</span>
                      </span>
                    </p>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input at bottom - sticky within the flex container */}
          <div className="sticky bottom-0 bg-white border-t border-[#EFEFEF] px-6 py-4">
            <form onSubmit={handleSubmit} className="max-w-[768px] mx-auto">
              <div className="relative">
                <textarea
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleTextareaKeyDown}
                  onInput={handleTextareaInput}
                  placeholder="Pose ta question juridique..."
                  rows={1}
                  disabled={isLoading}
                  className="w-full bg-[#F5F5F5] border border-[#E5E5E5] rounded-2xl px-5 py-4 pr-14 resize-none outline-none text-text placeholder:text-[#999] disabled:opacity-50 focus:bg-white focus:border-[#D0D0D0] transition-all min-h-[52px]"
                  style={{ maxHeight: "200px" }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !hasInput}
                  className={`absolute right-3 bottom-3 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    hasInput
                      ? "bg-[#1C1917] hover:bg-[#2C2927] text-white"
                      : "bg-[#E5E5E5] text-[#999] cursor-not-allowed"
                  }`}
                  aria-label="Envoyer"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 2L11 13" />
                    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
