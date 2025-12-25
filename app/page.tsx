"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DemoChat } from "@/components/demo-chat";
import { NomoLogo } from "@/components/NomoLogo";

const features = [
  {
    number: "01",
    title: "Sources verifiees",
    description: "Chaque reponse cite ses sources avec lien direct vers Legifrance",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    number: "02",
    title: "Zero hallucination",
    description: "L'IA ne repond que si elle trouve une source fiable",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    number: "03",
    title: "Fait pour les etudiants",
    description: "Jurisprudence, cas pratiques, articles de loi expliques simplement",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
        <path d="M6 12v5c3 3 9 3 12 0v-5" />
      </svg>
    ),
  },
];

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
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Animated grid background */}
      <div className="absolute inset-0 grid-background" />

      {/* Navbar */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 h-16 px-6 md:px-12 flex items-center justify-between transition-colors duration-300 ${
          scrolled ? "bg-background/80 backdrop-blur-sm" : "bg-transparent"
        }`}
      >
        <Link href="/" className="flex items-center gap-2">
          <NomoLogo size="md" />
          <span className="font-serif text-[24px] text-text">Nomo</span>
        </Link>
        <Link
          href="/login"
          className="text-text hover:underline underline-offset-4 transition-all"
        >
          Connexion
        </Link>
      </nav>

      {/* Main content */}
      <main className="relative z-10 flex-1">
        {/* Hero - reduced padding */}
        <section className="pt-24 md:pt-28 px-4 mb-12 md:mb-16">
          <div className="text-center max-w-4xl mx-auto">
            {/* Logo */}
            <div
              className={`flex justify-center mb-6 ${
                mounted ? "animate-fade-in-up" : "opacity-0"
              }`}
            >
              <NomoLogo size="lg" />
            </div>

            <h1
              className={`text-[44px] md:text-[64px] font-extrabold leading-[1.1] tracking-tight ${
                mounted ? "animate-hero-title" : "opacity-0"
              }`}
            >
              <span className="text-text">L&apos;IA </span>
              <span className="text-gradient">juridique</span>
              <span className="text-text"> des etudiants.</span>
            </h1>

            <p
              className={`mt-4 text-[18px] text-text-secondary max-w-xl mx-auto ${
                mounted ? "animate-fade-in-up animation-delay-100" : "opacity-0"
              }`}
            >
              Zero hallucination. Sources verifiees. Liens directs vers Legifrance.
            </p>

            {/* Social proof */}
            <p
              className={`mt-3 text-[14px] text-[#A1A1AA] ${
                mounted ? "animate-fade-in-up animation-delay-150" : "opacity-0"
              }`}
            >
              Utilise par les etudiants de Paris, Lyon, Bordeaux...
            </p>

            <div
              className={`mt-8 flex flex-col items-center ${
                mounted ? "animate-fade-in-up animation-delay-200" : "opacity-0"
              }`}
            >
              <Link href="/login">
                <button className="group relative bg-accent hover:bg-accent-hover text-white rounded-xl px-10 py-4 text-lg font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/40 hover:scale-[1.02] transition-all duration-200 flex items-center gap-3">
                  Commencer gratuitement
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-transform duration-200 group-hover:translate-x-1"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              </Link>
              <p className="mt-3 text-[14px] text-text-secondary">
                10 questions gratuites, sans carte bancaire
              </p>
            </div>
          </div>
        </section>

        {/* Two-column section */}
        <section
          className={`max-w-[1200px] mx-auto px-6 md:px-12 pb-20 ${
            mounted ? "animate-fade-in-up animation-delay-300" : "opacity-0"
          }`}
        >
          <div className="grid grid-cols-1 lg:grid-cols-[55%_45%] gap-8 lg:gap-12">
            {/* Left column - Demo (sticky on desktop) */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              <div className="demo-tilt">
                <DemoChat />
              </div>
            </div>

            {/* Right column - Features */}
            <div className="relative pl-0 lg:pl-4">
              {/* Timeline line */}
              <div className="hidden lg:block absolute left-0 top-8 bottom-8 w-[3px] bg-gradient-to-b from-accent via-accent/50 to-transparent rounded-full" />

              {/* Features list */}
              <div className="space-y-4">
                {features.map((feature, index) => (
                  <div
                    key={feature.number}
                    className="group relative flex items-start gap-5 p-5 rounded-xl transition-colors hover:bg-surface"
                    style={{ animationDelay: `${0.4 + index * 0.1}s` }}
                  >
                    {/* Number indicator */}
                    <div className="hidden lg:flex absolute -left-[13px] top-6 w-6 h-6 rounded-full bg-background border-[3px] border-accent items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-accent" />
                    </div>

                    {/* Large number for mobile */}
                    <span className="lg:hidden text-[32px] font-bold text-border leading-none">
                      {feature.number}
                    </span>

                    {/* Icon */}
                    <div className="hidden lg:flex w-12 h-12 rounded-xl bg-[#EFF6FF] items-center justify-center flex-shrink-0 text-accent">
                      {feature.icon}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-[20px] text-text mb-1">
                        {feature.title}
                      </h3>
                      <p className="text-[16px] text-text-secondary leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="py-20 px-6 md:px-12 bg-surface">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-[32px] md:text-[40px] font-bold text-center text-text mb-4">
              Un prix simple, fait pour les etudiants
            </h2>
            <p className="text-center text-text-secondary mb-12 max-w-xl mx-auto">
              Commence gratuitement, passe a l&apos;illimite quand tu veux.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Free Plan */}
              <div className="bg-background rounded-2xl border border-border p-8">
                <h3 className="text-[24px] font-bold text-text mb-2">Gratuit</h3>
                <p className="text-text-secondary mb-6">Pour decouvrir Nomo</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-[40px] font-bold text-text">0€</span>
                  <span className="text-text-secondary">/mois</span>
                </div>

                <ul className="space-y-3 mb-8">
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    10 questions par mois
                  </li>
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Acces aux articles de loi
                  </li>
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Sources verifiees
                  </li>
                </ul>

                <Link href="/login" className="block">
                  <button className="w-full py-3 px-6 rounded-xl border-2 border-border text-text font-medium hover:bg-surface transition-colors">
                    Commencer gratuitement
                  </button>
                </Link>
              </div>

              {/* Beta Plan */}
              <div className="relative bg-background rounded-2xl border-2 border-accent p-8 shadow-lg shadow-accent/10">
                {/* Badge */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-accent text-white text-[12px] font-semibold px-3 py-1 rounded-full">
                    Offre de lancement
                  </span>
                </div>

                <h3 className="text-[24px] font-bold text-text mb-2">Beta</h3>
                <p className="text-text-secondary mb-6">Acces complet a Nomo</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-[40px] font-bold text-accent">5€</span>
                  <span className="text-text-secondary">/mois</span>
                </div>

                <ul className="space-y-3 mb-8">
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Questions illimitees
                  </li>
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Acces a la jurisprudence
                  </li>
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Sources verifiees
                  </li>
                  <li className="flex items-center gap-3 text-text">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Support prioritaire
                  </li>
                </ul>

                <Link href="/pricing" className="block">
                  <button className="w-full py-3 px-6 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium transition-colors shadow-md hover:shadow-lg">
                    S&apos;abonner
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-20 px-6 md:px-12">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-[32px] md:text-[40px] font-bold text-center text-text mb-12">
              Questions frequentes
            </h2>

            <div className="space-y-6">
              {/* FAQ 1 */}
              <div className="bg-surface rounded-xl p-6">
                <h3 className="text-[18px] font-semibold text-text mb-2">
                  C&apos;est quoi Nomo ?
                </h3>
                <p className="text-text-secondary leading-relaxed">
                  Nomo est un assistant juridique base sur l&apos;intelligence artificielle, concu specialement pour les etudiants en droit. Il repond a tes questions en citant ses sources (articles de loi, jurisprudence) avec des liens directs vers Legifrance.
                </p>
              </div>

              {/* FAQ 2 */}
              <div className="bg-surface rounded-xl p-6">
                <h3 className="text-[18px] font-semibold text-text mb-2">
                  D&apos;ou viennent les sources ?
                </h3>
                <p className="text-text-secondary leading-relaxed">
                  Toutes nos sources proviennent de Legifrance, la base de donnees officielle du droit francais. Chaque reponse inclut des liens cliquables vers les textes originaux pour que tu puisses verifier par toi-meme.
                </p>
              </div>

              {/* FAQ 3 */}
              <div className="bg-surface rounded-xl p-6">
                <h3 className="text-[18px] font-semibold text-text mb-2">
                  Pourquoi 5€ et pas gratuit ?
                </h3>
                <p className="text-text-secondary leading-relaxed">
                  L&apos;IA coute cher a faire tourner (API Claude d&apos;Anthropic). Plutot que de diffuser des pubs ou de revendre tes donnees, on prefere un modele simple et transparent. 5€/mois permet de couvrir les couts tout en restant accessible pour un etudiant.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border bg-background px-6 md:px-12 py-6">
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
