import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PISTE_AUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const JUDILIBRE_API_URL = "https://api.piste.gouv.fr/cassation/judilibre/v1.0";

let accessToken: string | null = null;

async function getAccessToken(): Promise<string> {
  if (accessToken) return accessToken;

  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
  }

  const response = await fetch(PISTE_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "openid",
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  return accessToken!;
}

async function searchByNumber(numero: string): Promise<any> {
  const token = await getAccessToken();

  // Clean the numero
  const cleanNumero = numero.replace(/\s/g, "");

  const searchUrl = `${JUDILIBRE_API_URL}/search?query=${encodeURIComponent(cleanNumero)}&page_size=5`;

  const response = await fetch(searchUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.log("Search failed:", response.status, await response.text());
    return null;
  }

  return response.json();
}

async function main() {
  console.log("=== Test API Judilibre ===\n");

  // Test with known case numbers
  const testCases = [
    "98-11.381",  // Baldus
    "93-18.632",  // Chronopost
    "89-15.231",  // Blieck
    "19-18.741",  // Dépakine
    "17-18.608",  // PIP
  ];

  for (const numero of testCases) {
    console.log(`\n--- Recherche: ${numero} ---`);

    const result = await searchByNumber(numero);

    if (result && result.results && result.results.length > 0) {
      const first = result.results[0];
      console.log("ID Judilibre:", first.id);
      console.log("Numéro:", first.number);
      console.log("Date:", first.decision_date);
      console.log("URL:", `https://www.courdecassation.fr/decision/${first.id}`);
    } else {
      console.log("Aucun résultat trouvé");
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
