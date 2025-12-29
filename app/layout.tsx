import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://nomo-juridique.fr'),
  title: {
    default: "Nomo | Assistant IA pour etudiants en droit - Cas pratiques & CRFPA",
    template: "%s | Nomo",
  },
  description: "Nomo est l'assistant juridique IA qui aide les etudiants en droit (L2-M2) a reussir leurs cas pratiques, commentaires d'arret et preparation au CRFPA. Analyse intelligente avec sources fiables.",
  keywords: [
    "assistant juridique IA",
    "droit",
    "etudiant droit",
    "cas pratique",
    "CRFPA",
    "commentaire arret",
    "jurisprudence",
    "Legifrance",
    "code civil",
    "code penal",
  ],
  authors: [{ name: "Nomo" }],
  creator: "Nomo",
  publisher: "Nomo",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "https://nomo-juridique.fr",
    siteName: "Nomo",
    title: "Nomo | Assistant IA pour etudiants en droit",
    description: "L'IA juridique des etudiants. Zero hallucination, sources verifiees, liens directs vers Legifrance.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Nomo - Assistant IA juridique",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nomo | Assistant IA pour etudiants en droit",
    description: "L'IA juridique des etudiants. Zero hallucination, sources verifiees, liens directs vers Legifrance.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    // google: "votre-code-verification-google",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${inter.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
