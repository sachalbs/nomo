"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Trash2, Loader2 } from "lucide-react";
import { NomoLogo } from "@/components/NomoLogo";

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

function AppLayoutContent({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
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

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const deleteConversation = async (id: string) => {
    setDeletingId(id);
    setConversationToDelete(null);

    try {
      // Delete messages first (foreign key constraint)
      const { error: messagesError } = await supabase
        .from("messages")
        .delete()
        .eq("conversation_id", id);

      if (messagesError) throw messagesError;

      // Delete conversation
      const { error: convError } = await supabase
        .from("conversations")
        .delete()
        .eq("id", id);

      if (convError) throw convError;

      // Update local state
      setConversations((prev) => prev.filter((c) => c.id !== id));

      // Redirect if deleting active conversation
      if (currentConversationId === id) {
        router.push("/chat");
      }

      showToast("Conversation supprimée", "success");
    } catch (error) {
      console.error("Error deleting conversation:", error);
      showToast("Erreur lors de la suppression", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`h-screen bg-white border-r border-[#E2E8F0] flex flex-col flex-shrink-0 transition-all duration-200 ease-in-out ${
          sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden"
        }`}
      >
        {/* Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#E2E8F0]">
          <div className="flex items-center gap-2">
            <NomoLogo size="md" />
            <h1 className="font-semibold text-xl text-[#1E293B]">Nomo</h1>
            <span className="bg-[#EFF6FF] text-[#2563EB] text-[10px] font-medium px-2 py-0.5 rounded-full">
              Beta
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] transition-all duration-200"
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
              className="text-[#64748B]"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

        {/* New conversation button */}
        <div className="p-3">
          <button
            onClick={handleNewConversation}
            className="w-full h-10 flex items-center gap-2 px-3 rounded-lg border border-[#E2E8F0] text-[#1E293B] text-[14px] hover:bg-[#F1F5F9] hover:border-[#CBD5E1] transition-all duration-200"
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
            <p className="text-[#94A3B8] text-[14px] px-2">
              Aucune conversation
            </p>
          ) : (
            <nav className="space-y-0.5">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-[14px] transition-all duration-200 group ${
                    currentConversationId === conv.id
                      ? "bg-[#EFF6FF] text-[#2563EB]"
                      : "text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#1E293B]"
                  }`}
                >
                  <Link
                    href={`/chat?id=${conv.id}`}
                    className="flex-1 min-w-0 flex items-center"
                  >
                    <span
                      className={`truncate ${
                        currentConversationId === conv.id
                          ? "font-medium"
                          : ""
                      }`}
                    >
                      {conv.title}
                    </span>
                  </Link>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <span className="text-[12px] text-[#94A3B8] group-hover:hidden">
                      {formatRelativeDate(conv.updated_at)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConversationToDelete(conv.id);
                      }}
                      disabled={deletingId === conv.id}
                      className="hidden group-hover:flex w-6 h-6 items-center justify-center rounded hover:bg-red-50 transition-colors"
                      aria-label="Supprimer la conversation"
                    >
                      {deletingId === conv.id ? (
                        <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </nav>
          )}
        </div>

        {/* Logout */}
        <div className="p-4 border-t border-[#E2E8F0]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-[#64748B] hover:text-[#1E293B] transition-all duration-200 text-[14px]"
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
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        {/* Header when sidebar is closed */}
        {!sidebarOpen && (
          <header className="h-14 px-4 flex items-center gap-4 border-b border-[#E2E8F0] bg-white">
            <button
              onClick={toggleSidebar}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F1F5F9] transition-all duration-200"
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
                className="text-[#64748B]"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <NomoLogo size="md" />
            <h1 className="font-semibold text-xl text-[#1E293B]">Nomo</h1>
            <span className="bg-[#EFF6FF] text-[#2563EB] text-[10px] font-medium px-2 py-0.5 rounded-full">
              Beta
            </span>
          </header>
        )}
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
      </main>

      {/* Delete confirmation modal */}
      {conversationToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-[#1E293B] mb-2">
              Supprimer cette conversation ?
            </h3>
            <p className="text-[#64748B] text-sm mb-6">
              Cette action est irréversible.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConversationToDelete(null)}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={() => deleteConversation(conversationToDelete)}
                className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm font-medium z-50 transition-all duration-300 ${
            toast.type === "success"
              ? "bg-green-500 text-white"
              : "bg-red-500 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="flex h-screen bg-[#F8FAFC]" />}>
      <AppLayoutContent>{children}</AppLayoutContent>
    </Suspense>
  );
}
