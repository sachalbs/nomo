import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function check() {
  // Get sample of court decisions with source_url
  const { data } = await supabase
    .from("court_decisions")
    .select("landmark_name, title, case_number, source_url, external_id")
    .eq("is_landmark", true)
    .not("source_url", "is", null)
    .limit(10);

  console.log("=== Échantillon URLs actuelles ===\n");
  for (const d of data || []) {
    console.log("Arrêt:", d.landmark_name || d.title);
    console.log("Numéro:", d.case_number);
    console.log("URL:", d.source_url);
    console.log("External ID:", d.external_id);
    console.log("---");
  }

  // Get sample with null source_url
  const { data: noUrl } = await supabase
    .from("court_decisions")
    .select("landmark_name, title, case_number, external_id")
    .eq("is_landmark", true)
    .is("source_url", null)
    .limit(5);

  console.log("\n=== Arrêts sans URL ===\n");
  for (const d of noUrl || []) {
    console.log("Arrêt:", d.landmark_name || d.title);
    console.log("Numéro:", d.case_number);
    console.log("External ID:", d.external_id);
    console.log("---");
  }

  // Count all
  const { count: totalCount } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true });

  const { count: withUrlCount } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true })
    .not("source_url", "is", null);

  const { count: landmarkCount } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true })
    .eq("is_landmark", true);

  const { count: landmarkWithUrl } = await supabase
    .from("court_decisions")
    .select("*", { count: "exact", head: true })
    .eq("is_landmark", true)
    .not("source_url", "is", null);

  console.log("\n=== Statistiques ===");
  console.log("Total décisions:", totalCount);
  console.log("Avec URL:", withUrlCount);
  console.log("Landmarks:", landmarkCount);
  console.log("Landmarks avec URL:", landmarkWithUrl);
}

check().catch(console.error);
