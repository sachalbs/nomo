"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Home() {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 h-16 px-6 md:px-12 flex items-center justify-between transition-colors duration-300 ${
          scrolled ? "bg-background" : "bg-transparent"
        }`}
      >
        <Link href="/" className="font-serif text-[24px] text-text">
          Nomo
        </Link>
        <Link
          href="/login"
          className="text-text hover:underline underline-offset-4 transition-all"
        >
          Connexion
        </Link>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center pt-40 md:pt-44 px-4">
        <div className="text-center max-w-3xl">
          <h1
            className={`font-serif text-[40px] md:text-[56px] text-text leading-tight ${
              mounted ? "animate-fade-in-up" : "opacity-0"
            }`}
          >
            L&apos;IA juridique des etudiants.
          </h1>

          {/* Animated underline */}
          <div className="flex justify-center mt-3">
            <div
              className={`h-[3px] bg-accent rounded-full ${
                mounted ? "animate-expand" : "w-0"
              }`}
              style={{ maxWidth: "200px" }}
            />
          </div>

          <p
            className={`mt-6 text-[18px] text-text-secondary max-w-xl mx-auto ${
              mounted ? "animate-fade-in-up animation-delay-100" : "opacity-0"
            }`}
          >
            Zero hallucination. Sources verifiees. Liens directs vers Legifrance.
          </p>

          <div
            className={`mt-8 ${
              mounted ? "animate-fade-in-up animation-delay-200" : "opacity-0"
            }`}
          >
            <Link href="/login">
              <button className="bg-accent hover:bg-accent-hover text-white rounded-lg px-8 py-3.5 font-medium shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-200">
                Commencer gratuitement
              </button>
            </Link>
          </div>
        </div>

        {/* Value Cards Section */}
        <section className="w-full max-w-[960px] mt-20 md:mt-24 px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="animate-on-scroll bg-white border border-border rounded-lg p-6">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
              </div>
              <h3 className="font-semibold text-[18px] text-text mb-2">
                Sources verifiees
              </h3>
              <p className="text-[16px] text-text-secondary leading-relaxed">
                Chaque reponse cite ses sources avec lien direct vers Legifrance
              </p>
            </div>

            {/* Card 2 */}
            <div className="animate-on-scroll animation-delay-100 bg-white border border-border rounded-lg p-6">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3 className="font-semibold text-[18px] text-text mb-2">
                Zero hallucination
              </h3>
              <p className="text-[16px] text-text-secondary leading-relaxed">
                L&apos;IA ne repond que si elle trouve une source fiable
              </p>
            </div>

            {/* Card 3 */}
            <div className="animate-on-scroll animation-delay-200 bg-white border border-border rounded-lg p-6">
              <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center mb-4">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-accent"
                >
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                  <path d="M6 12v5c3 3 9 3 12 0v-5" />
                </svg>
              </div>
              <h3 className="font-semibold text-[18px] text-text mb-2">
                Fait pour les etudiants
              </h3>
              <p className="text-[16px] text-text-secondary leading-relaxed">
                Jurisprudence, cas pratiques, articles de loi expliques simplement
              </p>
            </div>
          </div>
        </section>

        {/* Spacer */}
        <div className="flex-1 min-h-20" />
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-background px-6 md:px-12 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[14px] text-text-secondary">Nomo &copy; 2025</p>
          <div className="flex gap-6">
            <Link
              href="/mentions-legales"
              className="text-[14px] text-text-secondary hover:text-text transition-colors"
            >
              Mentions legales
            </Link>
            <Link
              href="/cgu"
              className="text-[14px] text-text-secondary hover:text-text transition-colors"
            >
              CGU
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
