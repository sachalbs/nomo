import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center px-4">
          <h1 className="font-serif text-[48px] text-text leading-tight">
            L&apos;IA juridique des etudiants.
          </h1>
          <p className="mt-4 text-[18px] text-text-secondary max-w-xl mx-auto">
            Zero hallucination. Sources verifiees. Liens directs vers Legifrance.
          </p>
          <div className="mt-8">
            <Link href="/login">
              <Button>Commencer gratuitement</Button>
            </Link>
          </div>
        </div>
      </main>
      <footer className="py-6 text-center">
        <p className="text-[14px] text-text-secondary">Nomo &copy; 2025</p>
      </footer>
    </div>
  );
}
