import { LEGAL_CONCEPTS } from './legal-concepts';

export interface LawArticleSource {
  id: string;
  code_name: string;
  article_number: string;
  content: string;
  source_url?: string;
  similarity?: number;
}

// Extract article number from query
export function extractArticleNumber(text: string): string | null {
  const patterns = [
    /article\s+(L\.?\s*)?(\d+(?:-\d+)*)/i,
    /art\.?\s*(L\.?\s*)?(\d+(?:-\d+)*)/i,
    /\b(L\.?\s*\d+(?:-\d+)*)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const prefix = match[1] || '';
      const num = match[2] || match[1];
      return (prefix + num).replace(/\s+/g, '');
    }
  }
  return null;
}

// Match concepts from legal-concepts.ts
export function matchLegalConcepts(query: string): { code: string; articleNumber: string }[] {
  const results: { code: string; articleNumber: string }[] = [];
  const queryLower = query.toLowerCase();

  for (const [conceptName, concept] of Object.entries(LEGAL_CONCEPTS)) {
    const nameMatches = queryLower.includes(conceptName.toLowerCase());
    const keywordMatches = concept.keywords?.some((kw: string) =>
      queryLower.includes(kw.toLowerCase())
    );

    if (nameMatches || keywordMatches) {
      for (const articleGroup of concept.articles) {
        for (const articleNum of articleGroup.numbers) {
          results.push({
            code: articleGroup.code,
            articleNumber: articleNum
          });
        }
      }
    }
  }

  return results;
}

// Generate query variants for RAG-Fusion
export function generateQueryVariants(query: string): string[] {
  const variants: string[] = [];

  const legalTerms: Record<string, string[]> = {
    "responsabilité": ["1240", "1241", "faute", "dommage", "préjudice"],
    "contrat": ["1103", "obligation", "inexécution", "résolution"],
    "abus de confiance": ["314-1", "détournement", "pénal"],
    "abus de biens sociaux": ["L241-3", "L242-6", "dirigeant", "société"],
    "CDD": ["L1242-1", "durée déterminée", "travail", "terme"],
    "licenciement": ["L1234", "faute grave", "préavis", "indemnité"],
    "SARL": ["L223-1", "société", "gérant", "parts sociales"],
    "SAS": ["L227-1", "président", "actions simplifiée"],
    "prescription": ["délai", "action", "années"],
    "légitime défense": ["122-5", "pénal", "justificatif"],
    "homicide": ["221-6", "involontaire", "imprudence"],
    "garde à vue": ["62-2", "procédure pénale", "retenue"],
    "dol": ["1137", "vice", "consentement", "tromperie"],
    "caducité": ["1186", "1187", "ensemble contractuel"]
  };

  const queryLower = query.toLowerCase();
  for (const [term, relatedTerms] of Object.entries(legalTerms)) {
    if (queryLower.includes(term.toLowerCase())) {
      variants.push(relatedTerms.join(' '));
    }
  }

  const simplified = query
    .replace(/qu'est-ce que?|quels? sont|quelles? sont|comment|quel est le/gi, '')
    .replace(/\?/g, '')
    .trim();
  if (simplified !== query && simplified.length > 3) {
    variants.push(simplified);
  }

  return variants.slice(0, 4);
}

// Extract keywords from text
export function extractKeywords(text: string): string[] {
  const stopWords = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'à', 'au', 'aux', 'pour', 'par', 'sur', 'dans', 'avec', 'est', 'sont', 'que', 'qui', 'quoi', 'quel', 'quelle', 'quels', 'quelles', 'ce', 'cette', 'ces']);

  return text
    .toLowerCase()
    .replace(/[^\wàâäéèêëïîôùûüç\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

// Question analysis interface
export interface QuestionAnalysis {
  isLegalQuestion: boolean;
  domaines: string[]; // ["pénal", "civil", "fiscal", "travail", "commercial", "procédure"]
  problematiques: string[]; // ["dégradation de biens", "homicide involontaire", ...]
  qualificationsRecherchees: string[]; // ["destruction", "violence", "légitime défense", ...]
  articlesConnus: string[]; // ["322-1", "221-6", "122-5", ...] si Claude les connaît
  codesARechercher: string[]; // ["Code pénal", "Code de procédure pénale", ...]
  motsClesRecherche: string[]; // mots-clés pour la recherche vectorielle
  isCasPratique: boolean; // Si c'est un cas pratique avec faits à analyser
  structureRecommandee: string; // Structure de réponse adaptée au domaine
}

// Analyze question using Claude to extract legal elements
export async function analyzeQuestion(message: string, anthropicApiKey: string): Promise<QuestionAnalysis> {
  // Dynamic import to avoid bundling issues
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const anthropic = new Anthropic({
    apiKey: anthropicApiKey,
  });

  const systemPrompt = `Tu es un expert en droit français. Analyse cette question/cas pratique et identifie les éléments juridiques.

IMPORTANT :
- Lis l'ENSEMBLE du texte avant de répondre
- Identifie TOUS les domaines de droit concernés (un cas peut être transversal)
- Pour le pénal, identifie les infractions possibles et leurs articles
- Pour le civil, identifie les responsabilités et fondements
- Pour le fiscal, identifie les impôts/taxes concernés
- Ignore les mots qui ne sont pas juridiques (exemple: "SA" dans "SA voiture" n'est PAS une Société Anonyme)

Détermine aussi :
- Si c'est un cas pratique (énoncé avec faits à analyser juridiquement)
- La structure de réponse à utiliser

Pour la structure :
- Si UN SEUL domaine clairement identifié, utilise la structure spécifique :
  * Pénal : "Pour chaque infraction : Élément légal (article) → Élément matériel (acte/résultat) → Élément moral (intention) → Faits justificatifs éventuels"
  * Obligations/Contrats : "Qualification contrat → Validité → Effets → Responsabilité"
  * Travail : "Qualification relation → Obligations → Rupture → Contentieux"
  * Procédure pénale : "Cadre procédural → Validité actes → Nullités"
  * Administratif : "Compétence → Recevabilité → Légalité externe → Légalité interne"

- Si TRANSVERSAL (plusieurs domaines) ou PAS CLAIR : utilise la structure simple :
  "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"

La structure simple est le DÉFAUT si tu hésites.

Après avoir appliqué la/les checklist(s) pertinente(s), liste dans articlesConnus TOUS les articles que tu connais qui pourraient s'appliquer, même indirectement. Sois EXHAUSTIF.

Pour les problematiques, formule-les de manière PRÉCISE et ACTIONNABLE, pas vague.

Réponds UNIQUEMENT avec un JSON valide (sans markdown, sans backticks) :
{
  "isLegalQuestion": true/false,
  "domaines": ["pénal", "civil", ...],
  "problematiques": ["description problème 1", "description problème 2", ...],
  "qualificationsRecherchees": ["dégradation", "homicide involontaire", "violences", ...],
  "articlesConnus": ["322-1", "221-6", "L435-1 CSI", ...],
  "codesARechercher": ["Code pénal", "Code civil", ...],
  "motsClesRecherche": ["mot1", "mot2", ...],
  "isCasPratique": true/false,
  "structureRecommandee": "la structure choisie"
}`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: message }]
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    try {
      const analysis = JSON.parse(text);
      return analysis;
    } catch (parseError) {
      console.error('[ANALYSIS] JSON parse error:', parseError);
      // Fallback si le JSON est invalide
      return {
        isLegalQuestion: true,
        domaines: [],
        problematiques: [],
        qualificationsRecherchees: [],
        articlesConnus: [],
        codesARechercher: [],
        motsClesRecherche: [],
        isCasPratique: false,
        structureRecommandee: "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"
      };
    }
  } catch (error) {
    console.error('[ANALYSIS] Error calling Claude:', error);
    // Fallback en cas d'erreur API
    return {
      isLegalQuestion: true,
      domaines: [],
      problematiques: [],
      qualificationsRecherchees: [],
      articlesConnus: [],
      codesARechercher: [],
      motsClesRecherche: [],
      isCasPratique: false,
      structureRecommandee: "1. Qualification des faits → 2. Problème de droit → 3. Majeure (règle + articles) → 4. Mineure (En l'espèce...) → 5. Conclusion"
    };
  }
}

// Full RAG pipeline search
export async function fullRagSearch(
  supabase: any,
  query: string,
  embedding: number[],
  limit: number = 10,
  analysis?: QuestionAnalysis
): Promise<LawArticleSource[]> {
  const allResults: Map<string, { article: LawArticleSource; score: number }> = new Map();

  // 0. Known articles from analysis (highest priority)
  if (analysis && analysis.articlesConnus.length > 0) {
    for (const articleNum of analysis.articlesConnus) {
      const { data } = await supabase
        .from('law_articles')
        .select('id, code_name, article_number, content, source_url')
        .ilike('article_number', `%${articleNum}%`)
        .limit(2);

      if (data && data.length > 0) {
        data.forEach((article: any) => {
          const key = `${article.code_name}:${article.article_number}`;
          allResults.set(key, { article: { ...article, similarity: 1.0 }, score: 5.0 });
        });
      }
    }
  }

  // 1. Concept matching (highest priority)
  const conceptMatches = matchLegalConcepts(query);
  for (const match of conceptMatches) {
    const { data: conceptArticles } = await supabase
      .from('law_articles')
      .select('id, code_name, article_number, content, source_url')
      .eq('code_name', match.code)
      .ilike('article_number', `%${match.articleNumber.replace(/^Article\s*/i, '')}%`)
      .limit(1);

    if (conceptArticles && conceptArticles.length > 0) {
      const article = conceptArticles[0];
      const key = `${article.code_name}:${article.article_number}`;
      allResults.set(key, { article: { ...article, similarity: 0.99 }, score: 3.0 });
    }
  }

  // 2. Exact article number match
  const articleNum = extractArticleNumber(query);
  if (articleNum) {
    const { data: exactMatches } = await supabase
      .from('law_articles')
      .select('id, code_name, article_number, content, source_url')
      .ilike('article_number', `%${articleNum}%`)
      .limit(5);

    (exactMatches || []).forEach((article: any, rank: number) => {
      const key = `${article.code_name}:${article.article_number}`;
      if (!allResults.has(key)) {
        allResults.set(key, { article: { ...article, similarity: 0.98 }, score: 2.0 });
      }
    });
  }

  // 3. Vector search
  const { data: vectorResults } = await supabase.rpc('match_law_articles_filtered', {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: 15,
    filter_codes: null
  });

  (vectorResults || []).forEach((article: any, rank: number) => {
    const key = `${article.code_name}:${article.article_number}`;
    const score = 1 / (60 + rank + 1);
    const existing = allResults.get(key);
    if (existing) {
      existing.score += score;
    } else {
      allResults.set(key, { article, score });
    }
  });

  // 4. RAG-Fusion: search with query variants
  const variants = generateQueryVariants(query);
  for (const variant of variants) {
    const keywords = extractKeywords(variant);
    if (keywords.length === 0) continue;

    const conditions = keywords.slice(0, 3).map(kw => `content.ilike.%${kw}%`);
    const { data: variantResults } = await supabase
      .from('law_articles')
      .select('id, code_name, article_number, content, source_url')
      .or(conditions.join(','))
      .limit(10);

    (variantResults || []).forEach((article: any, rank: number) => {
      const key = `${article.code_name}:${article.article_number}`;
      const score = 0.5 / (60 + rank + 1);
      const existing = allResults.get(key);
      if (existing) {
        existing.score += score;
      } else {
        allResults.set(key, { article: { ...article, similarity: 0 }, score });
      }
    });
  }

  // Sort by score and return
  return Array.from(allResults.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ article }) => article);
}
