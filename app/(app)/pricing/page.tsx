"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NomoLogo } from "@/components/NomoLogo";
import { Check, Loader2 } from "lucide-react";

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    const checkSubscription = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_subscribed")
          .eq("id", user.id)
          .single();

        setIsSubscribed(profile?.is_subscribed || false);
      }
      setCheckingStatus(false);
    };

    checkSubscription();
  }, []);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("No checkout URL received");
        setLoading(false);
      }
    } catch (error) {
      console.error("Checkout error:", error);
      setLoading(false);
    }
  };

  const features = [
    "Accès illimité à Nomo",
    "24 000+ articles de loi français",
    "Jurisprudence récente",
    "Réponses sourcées et vérifiables",
    "Support prioritaire",
  ];

  if (checkingStatus) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#2563EB] animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full">
        {canceled && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
            Paiement annulé. Vous pouvez réessayer quand vous le souhaitez.
          </div>
        )}

        <div className="text-center mb-8">
          <NomoLogo size="xl" variant="filled" />
          <h1 className="mt-4 text-2xl font-semibold text-[#1E293B]">
            Nomo Beta
          </h1>
          <p className="mt-2 text-[#64748B]">
            L'assistant juridique des étudiants en droit
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-sm">
          <div className="text-center mb-6">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-[#1E293B]">5€</span>
              <span className="text-[#64748B]">/mois</span>
            </div>
            <p className="mt-2 text-sm text-[#64748B]">
              Sans engagement, annulable à tout moment
            </p>
          </div>

          <ul className="space-y-3 mb-6">
            {features.map((feature, i) => (
              <li key={i} className="flex items-center gap-3 text-[#1E293B]">
                <Check className="w-5 h-5 text-[#2563EB] flex-shrink-0" />
                <span className="text-sm">{feature}</span>
              </li>
            ))}
          </ul>

          {isSubscribed ? (
            <div className="w-full py-3 px-4 rounded-lg bg-green-50 border border-green-200 text-green-700 text-center font-medium">
              Vous êtes abonné
            </div>
          ) : (
            <button
              onClick={handleSubscribe}
              disabled={loading}
              className="w-full py-3 px-4 rounded-lg bg-[#2563EB] text-white font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Redirection...
                </>
              ) : (
                "S'abonner"
              )}
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-[#94A3B8]">
          Paiement sécurisé par Stripe. Vos données bancaires ne sont jamais
          stockées sur nos serveurs.
        </p>

        <button
          onClick={() => router.push("/chat")}
          className="mt-4 w-full text-center text-sm text-[#64748B] hover:text-[#1E293B] transition-colors"
        >
          Retour au chat
        </button>
      </div>
    </div>
  );
}
