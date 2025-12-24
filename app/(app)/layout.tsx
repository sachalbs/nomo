"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Conversation {
  id: string;
  title: string;
  updated_at: string;
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Aujourd'hui";
  } else if (diffDays === 1) {
    return "Hier";
  } else if (diffDays < 7) {
    return `${diffDays}j`;
  } else {
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const currentConversationId = searchParams.get("id");

  // Load sidebar state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("nomo-sidebar-open");
    if (saved !== null) {
      setSidebarOpen(JSON.parse(saved));
    }
  }, []);

  // Save sidebar state to localStorage
  const toggleSidebar = () => {
    const newState = !sidebarOpen;
    setSidebarOpen(newState);
    localStorage.setItem("nomo-sidebar-open", JSON.stringify(newState));
  };

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });

    if (!error && data) {
      setConversations(data);
    }
  };

  useEffect(() => {
    loadConversations();

    const handleNewConversation = () => {
      loadConversations();
    };
    window.addEventListener("conversationCreated", handleNewConversation);

    return () => {
      window.removeEventListener("conversationCreated", handleNewConversation);
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleNewConversation = () => {
    router.push("/chat");
  };

  return (
    <div className="flex h-screen bg-[#FAFAFA]">
      {/* Sidebar */}
      <aside
        className={`bg-white border-r border-[#EFEFEF] flex flex-col transition-all duration-200 ease-in-out ${
          sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden"
        }`}
      >
        {/* Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#EFEFEF]">
          <div className="flex items-center gap-2">
            <h1 className="font-semibold text-[18px] text-text">Nomo</h1>
            <span className="bg-[#F5F5F5] text-[#666] text-[10px] font-medium px-2 py-0.5 rounded-full">
              Beta
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F5F5F5] transition-colors"
            aria-label="Fermer la sidebar"
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
              className="text-[#666]"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* New conversation button */}
        <div className="p-3">
          <button
            onClick={handleNewConversation}
            className="w-full h-10 flex items-center gap-2 px-3 rounded-lg border border-[#EFEFEF] text-text text-[14px] hover:bg-[#F5F5F5] transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nouvelle conversation
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {conversations.length === 0 ? (
            <p className="text-text-secondary text-[14px] px-2">
              Aucune conversation
            </p>
          ) : (
            <nav className="space-y-0.5">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/chat?id=${conv.id}`}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-[14px] transition-colors group ${
                    currentConversationId === conv.id
                      ? "bg-[#F5F5F5]"
                      : "hover:bg-[#F5F5F5]"
                  }`}
                >
                  <span
                    className={`truncate max-w-[160px] ${
                      currentConversationId === conv.id
                        ? "text-text font-medium"
                        : "text-[#666] group-hover:text-text"
                    }`}
                  >
                    {conv.title}
                  </span>
                  <span className="text-[12px] text-[#999] flex-shrink-0 ml-2">
                    {formatRelativeDate(conv.updated_at)}
                  </span>
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* Logout */}
        <div className="p-4 border-t border-[#EFEFEF]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-[#666] hover:text-text transition-colors text-[14px]"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Deconnexion
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header when sidebar is closed */}
        {!sidebarOpen && (
          <header className="h-14 px-4 flex items-center gap-4 border-b border-[#EFEFEF] bg-white">
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F5F5F5] transition-colors"
              aria-label="Ouvrir la sidebar"
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
                className="text-[#666]"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <h1 className="font-semibold text-[18px] text-text">Nomo</h1>
          </header>
        )}
        <div className="flex-1 flex flex-col">{children}</div>
      </main>
    </div>
  );
}
