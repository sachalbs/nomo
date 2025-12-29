import type { Metadata } from "next";
import Link from "next/link";
import { NomoLogo } from "@/components/NomoLogo";

export const metadata: Metadata = {
  title: "Correction de Cas Pratique en Droit | IA Juridique - Nomo",
  description:
    "Obtenez une correction detaillee de vos cas pratiques en droit civil, penal, des contrats. Notre IA juridique analyse votre enonce et structure votre reponse avec la methodologie attendue.",
  openGraph: {
    title: "Correction de Cas Pratique en Droit | IA Juridique - Nomo",
    description:
      "Obtenez une correction detaillee de vos cas pratiques en droit civil, penal, des contrats. Notre IA juridique analyse votre enonce et structure votre reponse avec la methodologie attendue.",
    url: "https://nomo-juridique.fr/cas-pratique",
  },
};

const matieres = [
  "Droit civil (responsabilite, contrats, famille)",
  "Droit penal",
  "Droit administratif",
  "Droit des affaires",
  "Droit du travail",
];

const avantages = [
  {
    title: "Methodologie cas pratique respectee",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    title: "Articles de loi et jurisprudence cites",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      </svg>
    ),
  },
  {
    title: "Disponible 24h/24 avant tes partiels",
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

const steps = [
  {
    number: "01",
    title: "Colle ton enonce de cas pratique",
  },
  {
    number: "02",
    title: "Nomo identifie les faits, qualifie juridiquement et trouve les articles applicables",
  },
  {
    number: "03",
    title: "Tu recois une analyse structuree avec le plan et les arguments",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Comment faire un cas pratique en droit ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pour reussir un cas pratique en droit, il faut suivre une methodologie precise : 1) Identifier et qualifier les faits pertinents, 2) Degager le ou les problemes de droit, 3) Enoncer la regle de droit applicable (majeure), 4) Appliquer la regle aux faits (mineure), 5) Conclure. Nomo vous aide a structurer votre raisonnement en identifiant automatiquement les articles de loi et la jurisprudence applicable.",
      },
    },
    {
      "@type": "Question",
      name: "Quelle est la methodologie du cas pratique juridique ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "La methodologie du cas pratique juridique repose sur le syllogisme juridique : Majeure (regle de droit applicable), Mineure (application aux faits de l'espece), Conclusion (solution juridique). Chaque probleme de droit identifie doit etre traite selon ce schema. Il est essentiel de citer les fondements legaux (articles du Code civil, Code penal, etc.) et la jurisprudence pertinente.",
      },
    },
    {
      "@type": "Question",
      name: "Comment trouver le probleme de droit dans un cas pratique ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pour trouver le probleme de droit, analysez d'abord les faits pour identifier les situations juridiquement relevantes. Posez-vous la question : quelle est la difficulte juridique soulevee par les faits ? Le probleme de droit doit etre formule sous forme de question abstraite et generale. Par exemple, si un contrat est conteste, le probleme pourrait etre : 'Quelles sont les conditions de validite d'un contrat ?' Nomo vous aide a identifier ces problemes automatiquement.",
      },
    },
  ],
};

export default function CasPratiquePage() {
  return (
    <>
      {/* Schema.org FAQ */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <div className="min-h-screen flex flex-col relative overflow-hidden">
        {/* Animated grid background */}
        <div className="absolute inset-0 grid-background" />

        {/* Navbar */}
        <nav className="fixed top-0 left-0 right-0 z-50 h-16 px-6 md:px-12 flex items-center justify-between bg-background/80 backdrop-blur-sm">
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
          {/* Hero */}
          <section className="pt-28 md:pt-32 px-4 mb-16 md:mb-20">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-[36px] md:text-[52px] font-extrabold leading-[1.1] tracking-tight">
                <span className="text-text">Reussis tes </span>
                <span className="text-gradient">cas pratiques</span>
                <span className="text-text"> en droit avec l&apos;IA</span>
              </h1>

              <p className="mt-6 text-[18px] text-text-secondary max-w-2xl mx-auto leading-relaxed">
                Tu bloques sur un cas pratique ? Nomo analyse ton enonce, identifie les problemes
                juridiques et te guide pas a pas vers une copie structuree — majeure, mineure,
                conclusion. Fini les heures perdues a chercher le bon fondement.
              </p>

              <div className="mt-10">
                <Link href="/signup">
                  <button className="group relative bg-accent hover:bg-accent-hover text-white rounded-xl px-10 py-4 text-lg font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/40 hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 mx-auto">
                    Essayer gratuitement
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
              </div>
            </div>
          </section>

          {/* Comment ca marche */}
          <section className="py-16 px-6 md:px-12 bg-surface">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Comment ca marche
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {steps.map((step) => (
                  <div key={step.number} className="text-center">
                    <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                      <span className="text-[20px] font-bold text-accent">{step.number}</span>
                    </div>
                    <p className="text-text leading-relaxed">{step.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Pour toutes les matieres */}
          <section className="py-16 px-6 md:px-12">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Pour toutes les matieres
              </h2>

              <div className="flex flex-wrap justify-center gap-4">
                {matieres.map((matiere) => (
                  <div
                    key={matiere}
                    className="bg-surface border border-border rounded-xl px-6 py-3 text-text"
                  >
                    {matiere}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Ce que Nomo t'apporte */}
          <section className="py-16 px-6 md:px-12 bg-surface">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Ce que Nomo t&apos;apporte
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {avantages.map((avantage) => (
                  <div
                    key={avantage.title}
                    className="bg-background rounded-xl border border-border p-6 text-center"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] flex items-center justify-center mx-auto mb-4 text-accent">
                      {avantage.icon}
                    </div>
                    <p className="text-text font-medium">{avantage.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* FAQ Section */}
          <section className="py-16 px-6 md:px-12">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Questions frequentes
              </h2>

              <div className="space-y-6">
                <div className="bg-surface rounded-xl p-6">
                  <h3 className="text-[18px] font-semibold text-text mb-2">
                    Comment faire un cas pratique en droit ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    Pour reussir un cas pratique en droit, il faut suivre une methodologie precise :
                    1) Identifier et qualifier les faits pertinents, 2) Degager le ou les problemes
                    de droit, 3) Enoncer la regle de droit applicable (majeure), 4) Appliquer la
                    regle aux faits (mineure), 5) Conclure. Nomo vous aide a structurer votre
                    raisonnement en identifiant automatiquement les articles de loi et la
                    jurisprudence applicable.
                  </p>
                </div>

                <div className="bg-surface rounded-xl p-6">
                  <h3 className="text-[18px] font-semibold text-text mb-2">
                    Quelle est la methodologie du cas pratique juridique ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    La methodologie du cas pratique juridique repose sur le syllogisme juridique :
                    Majeure (regle de droit applicable), Mineure (application aux faits de
                    l&apos;espece), Conclusion (solution juridique). Chaque probleme de droit
                    identifie doit etre traite selon ce schema. Il est essentiel de citer les
                    fondements legaux (articles du Code civil, Code penal, etc.) et la jurisprudence
                    pertinente.
                  </p>
                </div>

                <div className="bg-surface rounded-xl p-6">
                  <h3 className="text-[18px] font-semibold text-text mb-2">
                    Comment trouver le probleme de droit dans un cas pratique ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    Pour trouver le probleme de droit, analysez d&apos;abord les faits pour
                    identifier les situations juridiquement relevantes. Posez-vous la question :
                    quelle est la difficulte juridique soulevee par les faits ? Le probleme de droit
                    doit etre formule sous forme de question abstraite et generale. Par exemple, si
                    un contrat est conteste, le probleme pourrait etre : &laquo; Quelles sont les
                    conditions de validite d&apos;un contrat ? &raquo; Nomo vous aide a identifier
                    ces problemes automatiquement.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* CTA Final */}
          <section className="py-20 px-6 md:px-12 bg-surface">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-[28px] md:text-[36px] font-bold text-text mb-6">
                Pret a reussir ton prochain cas pratique ?
              </h2>
              <p className="text-text-secondary mb-8">
                Rejoins les etudiants qui utilisent deja Nomo pour leurs revisions.
              </p>
              <Link href="/signup">
                <button className="group relative bg-accent hover:bg-accent-hover text-white rounded-xl px-10 py-4 text-lg font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/40 hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 mx-auto">
                  Essayer gratuitement
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
              <p className="mt-4 text-[14px] text-text-secondary">
                10 questions gratuites, sans carte bancaire
              </p>
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
    </>
  );
}
