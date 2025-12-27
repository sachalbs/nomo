"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ReactMarkdown from "react-markdown";
import { NomoLogo } from "@/components/NomoLogo";

interface Source {
  type?: "article" | "jurisprudence";
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
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
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

// Format court decision display
function formatCourtDecision(source: Source): string {
  // Extract case number from article_number (e.g., "Arret 23-12.483" -> "23-12.483")
  const caseNumber = source.article_number.replace(/^Arret\s+/i, "");

  // code_name contains jurisdiction and chambre (e.g., "Cass. civ. 1ère")
  const jurisdiction = source.code_name;

  return `${jurisdiction}, n° ${caseNumber}`;
}

// Sources display component
// Helper to detect if a source is jurisprudence (arrêt) vs article de loi
function isJurisprudence(source: Source): boolean {
  const articleNum = (source.article_number || "").toLowerCase();
  const codeName = (source.code_name || "").toLowerCase();

  // Log all checks for debugging
  const checks = {
    type: source.type,
    typeIsJurisp: source.type === "jurisprudence",
    articleNum: source.article_number,
    startsWithArret: articleNum.startsWith("arret") || articleNum.startsWith("arrêt"),
    hasPourvoi: /\d{2}-\d{2}\.\d{3}/.test(articleNum),
    codeName: source.code_name,
    hasCass: codeName.includes("cass"),
  };
  console.log("isJurisprudence checks:", checks);

  // 1. Type field (most reliable)
  if (source.type === "jurisprudence") return true;
  if (source.type === "article") return false;

  // 2. article_number starts with "Arret" or "Arrêt"
  if (articleNum.startsWith("arret") || articleNum.startsWith("arrêt")) return true;

  // 3. Contains pourvoi pattern XX-XX.XXX
  if (/\d{2}-\d{2}\.\d{3}/.test(source.article_number || "")) return true;

  // 4. code_name contains court indicators
  if (codeName.includes("cass")) return true;
  if (codeName.includes("cour d'appel")) return true;

  return false;
}

function SourcesDisplay({ sources }: { sources: Source[] }) {
  // DEBUG: Log each source to see exact structure
  console.log("=== SOURCES DEBUG ===");
  sources.forEach((s, i) => {
    console.log(`Source [${i}]:`, JSON.stringify(s, null, 2));
    console.log(`  -> isJurisprudence: ${isJurisprudence(s)}`);
  });
  console.log("=== END SOURCES DEBUG ===");

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {/* Render each source with appropriate style */}
      {sources.map((source, idx) => {
        const isArret = isJurisprudence(source);

        if (isArret) {
          // ARRÊT - Style orange avec ⚖️ (inline styles car amber pas compilé par Tailwind)
          return (
            <a
              key={idx}
              href={source.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-colors"
              style={{
                backgroundColor: '#fffbeb',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: '#fcd34d',
                color: '#b45309'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#fef3c7';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#fffbeb';
              }}
            >
              <span>⚖️</span>
              <span className="font-medium">{formatCourtDecision(source)}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.5 }}>
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          );
        } else {
          // ARTICLE - Style bleu avec 📜
          return (
            <a
              key={idx}
              href={source.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-full text-sm transition-colors"
            >
              <span>📜</span>
              <span className="font-medium">{source.article_number}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="opacity-50">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          );
        }
      })}
    </div>
  );
}

const loadingSteps = [
  "Analyse de votre question...",
  "Recherche dans 24 000 articles de loi...",
  "Identification des sources pertinentes...",
  "Redaction de la reponse...",
];

function ChatPageContent() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState<number>(0);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);
  const [showSubscriptionBanner, setShowSubscriptionBanner] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();

  // Progress through loading steps
  useEffect(() => {
    if (!isLoading) {
      setLoadingStep(0);
      return;
    }

    // Step 0 immediately, then progress through steps
    const timers: NodeJS.Timeout[] = [];

    timers.push(setTimeout(() => setLoadingStep(1), 800));
    timers.push(setTimeout(() => setLoadingStep(2), 2500));
    timers.push(setTimeout(() => setLoadingStep(3), 4000));

    return () => {
      timers.forEach(clearTimeout);
    };
  }, [isLoading]);

  useEffect(() => {
    const fetchUserAndProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.full_name) {
        const firstName = user.user_metadata.full_name.split(" ")[0];
        setUserName(firstName);
      }

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("message_count, is_subscribed")
          .eq("id", user.id)
          .single();

        if (profile) {
          setMessageCount(profile.message_count || 0);
          setIsSubscribed(profile.is_subscribed || false);
        }
      }
    };
    fetchUserAndProfile();
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
        // Handle subscription required error
        if (response.status === 402 && data.error === "subscription_required") {
          setShowSubscriptionBanner(true);
          setMessages((prev) => prev.filter((m) => m.id !== "temp-user"));
          return;
        }
        throw new Error(data.error || "Failed to send message");
      }

      // Increment local message count
      setMessageCount((prev) => prev + 1);

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
  const messagesRemaining = Math.max(0, 10 - messageCount);

  return (
    <div className="h-full flex flex-col bg-[#F8FAFC]">
      {/* Subscription banner */}
      {showSubscriptionBanner && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4">
          <div className="max-w-[800px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="text-amber-800">
                Vous avez atteint la limite de 10 messages gratuits.
              </span>
            </div>
            <button
              onClick={() => router.push("/pricing")}
              className="px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
            >
              S'abonner
            </button>
          </div>
        </div>
      )}

      {/* Messages remaining indicator (only show if not subscribed and has used messages) */}
      {!isSubscribed && messageCount > 0 && !showSubscriptionBanner && (
        <div className="bg-[#EFF6FF] border-b border-[#DBEAFE] px-6 py-2">
          <div className="max-w-[800px] mx-auto flex items-center justify-center gap-2 text-sm text-[#2563EB]">
            <span>{messagesRemaining} message{messagesRemaining !== 1 ? 's' : ''} gratuit{messagesRemaining !== 1 ? 's' : ''} restant{messagesRemaining !== 1 ? 's' : ''}</span>
            <span className="text-[#94A3B8]">•</span>
            <button
              onClick={() => router.push("/pricing")}
              className="font-medium hover:underline"
            >
              Passer à l'illimité
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        // Empty state - centered input
        <div className="flex-1 flex flex-col items-center justify-center px-6 -mt-8">
          {/* Logo + Greeting */}
          <div className="flex items-center gap-4 mb-8">
            <NomoLogo size="xl" variant="outline" breathing />
            <h1 className="font-semibold text-[32px] text-[#1E293B]">
              {userName ? `Bonjour, ${userName}` : "Pose ta question juridique"}
            </h1>
          </div>

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
                  className="w-full bg-white border border-[#E2E8F0] rounded-full px-6 py-4 pr-14 resize-none outline-none text-[#1E293B] placeholder:text-[#94A3B8] disabled:opacity-50 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 transition-all duration-200 min-h-[56px] shadow-sm"
                  style={{ maxHeight: "56px" }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !hasInput}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                    hasInput
                      ? "bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-md"
                      : "bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed"
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
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </form>
          </div>

          {/* Suggestions */}
          <div className="flex flex-wrap justify-center gap-3 mt-6 max-w-[600px]">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.text}
                onClick={() => handleSuggestionClick(suggestion.text)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[#E2E8F0] text-[14px] text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B] hover:border-[#CBD5E1] transition-all duration-200 shadow-sm"
              >
                <span className="text-[#94A3B8]">{suggestion.icon}</span>
                {suggestion.text}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // Messages state
        <div className="flex-1 flex flex-col relative">
          <div className="flex-1 overflow-y-auto pb-32">
            <div className="max-w-[800px] mx-auto px-6 py-6 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`chat-message flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {/* Logo for assistant messages */}
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 mr-3">
                      <NomoLogo size="md" variant="filled" />
                    </div>
                  )}

                  <div className={`${msg.role === "user" ? "max-w-[70%]" : "max-w-[85%]"} space-y-2`}>
                    <div
                      className={`px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-[#2563EB] text-white rounded-2xl rounded-tr-sm shadow-md"
                          : "bg-white border border-[#E2E8F0] text-[#1E293B] rounded-2xl rounded-tl-sm shadow-sm"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        <div className="prose-nomo">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>

                    {/* Sources for assistant messages */}
                    {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                      <SourcesDisplay sources={msg.sources} />
                    )}

                    {/* Timestamp */}
                    <p className={`text-[11px] text-[#94A3B8] ${msg.role === "user" ? "text-right" : "text-left"} px-1`}>
                      {formatTime(msg.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="chat-message flex justify-start">
                  <div className="flex-shrink-0 mr-3">
                    <NomoLogo size="md" variant="filled" animated />
                  </div>
                  <div className="bg-white border border-[#E2E8F0] px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm min-w-[280px]">
                    <div className="flex items-center gap-2">
                      <span className="text-[#1E293B] font-medium transition-all duration-300">
                        {loadingSteps[loadingStep]}
                      </span>
                      <span className="flex gap-0.5">
                        <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                    </div>
                    {/* Progress indicator */}
                    <div className="mt-2 flex gap-1">
                      {loadingSteps.map((_, i) => (
                        <div
                          key={i}
                          className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                            i <= loadingStep ? "bg-[#2563EB]" : "bg-[#E2E8F0]"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Fixed input at bottom */}
          <div className="fixed bottom-0 left-0 right-0 md:left-[260px] bg-[#F8FAFC]/80 backdrop-blur-lg border-t border-[#E2E8F0] px-6 py-4">
            <form onSubmit={handleSubmit} className="max-w-[800px] mx-auto">
              <div className="relative">
                <textarea
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleTextareaKeyDown}
                  onInput={handleTextareaInput}
                  placeholder="Pose ta question..."
                  rows={1}
                  disabled={isLoading}
                  className="w-full bg-white border border-[#E2E8F0] rounded-full px-6 py-4 pr-14 resize-none outline-none text-[#1E293B] placeholder:text-[#94A3B8] disabled:opacity-50 focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 transition-all duration-200 min-h-[56px] shadow-sm"
                  style={{ maxHeight: "56px" }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !hasInput}
                  className={`absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                    hasInput
                      ? "bg-[#2563EB] hover:bg-[#1D4ED8] text-white shadow-md"
                      : "bg-[#E2E8F0] text-[#94A3B8] cursor-not-allowed"
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
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
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

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-full flex flex-col bg-[#F8FAFC]" />}>
      <ChatPageContent />
    </Suspense>
  );
}
