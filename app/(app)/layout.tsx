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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const currentConversationId = searchParams.get("id");

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

    // Listen for new conversations
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
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-[240px] bg-background border-r border-border flex flex-col">
        {/* Logo */}
        <div className="p-4">
          <h1 className="font-serif text-[24px] text-text">Nomo</h1>
        </div>

        {/* New conversation button */}
        <div className="px-4">
          <button
            onClick={handleNewConversation}
            className="w-full bg-accent text-white rounded-lg px-4 py-2.5 font-medium hover:bg-accent-hover transition-colors"
          >
            + Nouvelle conversation
          </button>
        </div>

        {/* Conversations list */}
        <div className="flex-1 overflow-y-auto px-2 py-4">
          {conversations.length === 0 ? (
            <p className="text-text-secondary text-[14px] px-2">
              Aucune conversation
            </p>
          ) : (
            <nav className="space-y-1">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  href={`/chat?id=${conv.id}`}
                  className={`block px-3 py-2 rounded-lg text-[14px] truncate transition-colors ${
                    currentConversationId === conv.id
                      ? "bg-surface text-text"
                      : "text-text-secondary hover:bg-surface hover:text-text"
                  }`}
                >
                  {conv.title}
                </Link>
              ))}
            </nav>
          )}
        </div>

        {/* Logout button */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="text-text-secondary hover:text-text transition-colors text-[14px]"
          >
            Deconnexion
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 bg-white">{children}</main>
    </div>
  );
}
