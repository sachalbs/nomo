import type { Metadata } from "next";
import Link from "next/link";
import { NomoLogo } from "@/components/NomoLogo";

export const metadata: Metadata = {
  title: "Aide Droit L1 | Reussir sa premiere annee de droit - Nomo",
  description:
    "Tu galeres en L1 droit ? Nomo t'aide a comprendre le droit constitutionnel, l'introduction au droit et les fondamentaux juridiques. IA disponible 24h/24 pour tes revisions.",
  openGraph: {
    title: "Aide Droit L1 | Reussir sa premiere annee de droit - Nomo",
    description:
      "Tu galeres en L1 droit ? Nomo t'aide a comprendre le droit constitutionnel, l'introduction au droit et les fondamentaux juridiques. IA disponible 24h/24 pour tes revisions.",
    url: "https://nomo-juridique.fr/l1-droit",
  },
};

const matieres = [
  {
    title: "Introduction au droit",
    description: "sources du droit, hierarchie des normes",
  },
  {
    title: "Droit constitutionnel",
    description: "Ve Republique, controle de constitutionnalite",
  },
  {
    title: "Droit de la famille",
    description: "mariage, divorce, filiation",
  },
  {
    title: "Histoire du droit",
    description: "droit romain, ancien droit",
  },
  {
    title: "Institutions juridictionnelles",
    description: "organisation judiciaire, competences",
  },
];

const problemes = [
  {
    probleme: "Je comprends pas mon cours",
    solution: "Nomo te le reexplique simplement",
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
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    ),
  },
  {
    probleme: "Je sais pas faire une fiche d'arret",
    solution: "Nomo te guide etape par etape",
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
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    probleme: "J'ai un TD demain",
    solution: "Colle ton sujet, obtiens une analyse structuree",
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

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Comment reussir sa L1 droit ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pour reussir sa L1 droit, il faut : 1) Assister a tous les cours et TD, 2) Apprendre la methodologie juridique des le debut (fiche d'arret, cas pratique, dissertation), 3) Reviser regulierement et ne pas attendre les partiels, 4) Maitriser le vocabulaire juridique, 5) S'entrainer sur des annales. Nomo peut t'aider a comprendre tes cours et a t'entrainer sur la methodologie.",
      },
    },
    {
      "@type": "Question",
      name: "Quelles sont les matieres en L1 droit ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "En L1 droit, les matieres principales sont : Introduction au droit (sources du droit, hierarchie des normes), Droit constitutionnel (institutions de la Ve Republique, controle de constitutionnalite), Droit de la famille, Histoire du droit, et Institutions juridictionnelles. Selon les universites, on peut aussi avoir des matieres complementaires comme les relations internationales ou l'economie.",
      },
    },
    {
      "@type": "Question",
      name: "Comment reviser le droit constitutionnel ?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Pour reviser le droit constitutionnel efficacement : 1) Maitrisez la Constitution de 1958 et ses articles cles, 2) Comprenez le fonctionnement des institutions (President, Gouvernement, Parlement, Conseil constitutionnel), 3) Apprenez les grandes decisions du Conseil constitutionnel, 4) Entrainez-vous sur des dissertations et commentaires de texte, 5) Faites des fiches par theme. Nomo peut vous aider a comprendre les concepts et a reviser.",
      },
    },
  ],
};

export default function L1DroitPage() {
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
                <span className="text-text">Reussis ta </span>
                <span className="text-gradient">L1 Droit</span>
                <span className="text-text"> avec une IA qui t&apos;explique tout</span>
              </h1>

              <p className="mt-6 text-[18px] text-text-secondary max-w-2xl mx-auto leading-relaxed">
                La L1 c&apos;est le choc : nouveaux concepts, vocabulaire juridique, methodologie
                inconnue. Nomo t&apos;accompagne pour comprendre tes cours, preparer tes TD et
                reviser efficacement. Pose tes questions, obtiens des reponses claires.
              </p>

              <div className="mt-10">
                <Link href="/signup">
                  <button className="group relative bg-accent hover:bg-accent-hover text-white rounded-xl px-10 py-4 text-lg font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/40 hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 mx-auto">
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
              </div>
            </div>
          </section>

          {/* Les matieres de L1 */}
          <section className="py-16 px-6 md:px-12 bg-surface">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Les matieres de L1 ou Nomo t&apos;aide
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {matieres.map((matiere) => (
                  <div
                    key={matiere.title}
                    className="bg-background border border-border rounded-xl p-5"
                  >
                    <h3 className="font-semibold text-text mb-1">{matiere.title}</h3>
                    <p className="text-[14px] text-text-secondary">{matiere.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Tes problemes, nos solutions */}
          <section className="py-16 px-6 md:px-12">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-[28px] md:text-[36px] font-bold text-center text-text mb-12">
                Tes problemes en L1, nos solutions
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {problemes.map((item) => (
                  <div
                    key={item.probleme}
                    className="bg-surface border border-border rounded-xl p-6"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#EFF6FF] flex items-center justify-center mb-4 text-accent">
                      {item.icon}
                    </div>
                    <p className="text-text font-medium mb-2">&laquo; {item.probleme} &raquo;</p>
                    <p className="text-text-secondary text-[14px]">→ {item.solution}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Temoignage */}
          <section className="py-16 px-6 md:px-12 bg-surface">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-[28px] md:text-[36px] font-bold text-text mb-8">Temoignage</h2>

              <div className="bg-background border border-border rounded-2xl p-8">
                <svg
                  className="w-10 h-10 text-accent/30 mx-auto mb-4"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                </svg>
                <blockquote className="text-[18px] text-text leading-relaxed mb-4">
                  J&apos;ai valide ma L1 grace a Nomo. Je comprenais enfin mes cours de droit
                  constit.
                </blockquote>
                <p className="text-text-secondary text-[14px]">— Etudiant, Paris 1</p>
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
                    Comment reussir sa L1 droit ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    Pour reussir sa L1 droit, il faut : 1) Assister a tous les cours et TD, 2)
                    Apprendre la methodologie juridique des le debut (fiche d&apos;arret, cas
                    pratique, dissertation), 3) Reviser regulierement et ne pas attendre les
                    partiels, 4) Maitriser le vocabulaire juridique, 5) S&apos;entrainer sur des
                    annales. Nomo peut t&apos;aider a comprendre tes cours et a t&apos;entrainer sur
                    la methodologie.
                  </p>
                </div>

                <div className="bg-surface rounded-xl p-6">
                  <h3 className="text-[18px] font-semibold text-text mb-2">
                    Quelles sont les matieres en L1 droit ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    En L1 droit, les matieres principales sont : Introduction au droit (sources du
                    droit, hierarchie des normes), Droit constitutionnel (institutions de la Ve
                    Republique, controle de constitutionnalite), Droit de la famille, Histoire du
                    droit, et Institutions juridictionnelles. Selon les universites, on peut aussi
                    avoir des matieres complementaires comme les relations internationales ou
                    l&apos;economie.
                  </p>
                </div>

                <div className="bg-surface rounded-xl p-6">
                  <h3 className="text-[18px] font-semibold text-text mb-2">
                    Comment reviser le droit constitutionnel ?
                  </h3>
                  <p className="text-text-secondary leading-relaxed">
                    Pour reviser le droit constitutionnel efficacement : 1) Maitrisez la
                    Constitution de 1958 et ses articles cles, 2) Comprenez le fonctionnement des
                    institutions (President, Gouvernement, Parlement, Conseil constitutionnel), 3)
                    Apprenez les grandes decisions du Conseil constitutionnel, 4) Entrainez-vous sur
                    des dissertations et commentaires de texte, 5) Faites des fiches par theme. Nomo
                    peut vous aider a comprendre les concepts et a reviser.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* CTA Final */}
          <section className="py-20 px-6 md:px-12 bg-surface">
            <div className="max-w-2xl mx-auto text-center">
              <h2 className="text-[28px] md:text-[36px] font-bold text-text mb-6">
                Pret a reussir ta L1 ?
              </h2>
              <p className="text-text-secondary mb-8">
                Rejoins les etudiants qui utilisent deja Nomo pour comprendre leurs cours.
              </p>
              <Link href="/signup">
                <button className="group relative bg-accent hover:bg-accent-hover text-white rounded-xl px-10 py-4 text-lg font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/40 hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 mx-auto">
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
