const OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const API_BASE_URL = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

// Code civil identifier
export const CODE_CIVIL_ID = "LEGITEXT000006070721";

interface OAuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface TableMatieresSection {
  id: string;
  cid: string;
  intOrdre: number;
  title: string;
  etat: string;
  articles?: TableMatieresArticle[];
  sections?: TableMatieresSection[];
}

interface TableMatieresArticle {
  id: string;
  cid: string;
  intOrdre: number;
  num: string;
  etat: string;
}

interface TableMatieresResponse {
  sections: TableMatieresSection[];
}

interface ArticleResponse {
  article: {
    id: string;
    cid: string;
    num: string;
    texte: string;
    texteHtml: string;
    etat: string;
    dateDebut: string;
    dateFin: string | null;
    nota: string | null;
  };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token;
  }

  const clientId = process.env.PISTE_CLIENT_ID;
  const clientSecret = process.env.PISTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PISTE_CLIENT_ID or PISTE_CLIENT_SECRET");
  }

  const response = await fetch(OAUTH_URL, {
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
    const error = await response.text();
    throw new Error(`OAuth error: ${response.status} - ${error}`);
  }

  const data: OAuthToken = await response.json();

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

async function apiRequest<T>(endpoint: string, body?: object): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export async function getTableMatieres(
  codeId: string
): Promise<TableMatieresResponse> {
  return apiRequest<TableMatieresResponse>("/consult/code/tableMatieres", {
    textId: codeId,
    date: new Date().toISOString().split("T")[0],
  });
}

export async function getArticle(articleId: string): Promise<ArticleResponse> {
  return apiRequest<ArticleResponse>("/consult/getArticle", {
    id: articleId,
  });
}

// Extract all article IDs from table des matieres recursively
export function extractArticleIds(
  sections: TableMatieresSection[]
): { id: string; num: string }[] {
  const articles: { id: string; num: string }[] = [];

  function traverse(section: TableMatieresSection) {
    // Add articles from this section
    if (section.articles) {
      for (const article of section.articles) {
        // Only include articles in force (VIGUEUR)
        if (article.etat === "VIGUEUR") {
          articles.push({ id: article.id, num: article.num });
        }
      }
    }

    // Recursively process sub-sections
    if (section.sections) {
      for (const subSection of section.sections) {
        traverse(subSection);
      }
    }
  }

  for (const section of sections) {
    traverse(section);
  }

  return articles;
}

// Clean HTML tags from article text
export function cleanArticleText(htmlText: string): string {
  return htmlText
    .replace(/<[^>]*>/g, " ") // Remove HTML tags
    .replace(/&nbsp;/g, " ") // Replace &nbsp;
    .replace(/&amp;/g, "&") // Replace &amp;
    .replace(/&lt;/g, "<") // Replace &lt;
    .replace(/&gt;/g, ">") // Replace &gt;
    .replace(/&quot;/g, '"') // Replace &quot;
    .replace(/&#39;/g, "'") // Replace &#39;
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

// Build Legifrance URL for an article
// Format: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI...
export function buildLegifranceUrl(articleId: string): string {
  return `https://www.legifrance.gouv.fr/codes/article_lc/${articleId}`;
}
