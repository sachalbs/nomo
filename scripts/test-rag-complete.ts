// @ts-nocheck
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "../lib/embeddings";
import { LEGAL_CONCEPTS } from "../lib/legal-concepts";
import fs from "fs";
import path from "path";

// Types
type QuestionLevel =
  | "L1"
  | "L2"
  | "L3"
  | "M1"
  | "M2"
  | "cas_pratique"
  | "procedure"
  | "piege"
  | "ambigue"
  | "article"
  | "familier";

type QuestionDomain =
  | "civil"
  | "penal"
  | "travail"
  | "commercial"
  | "procedure_civile"
  | "procedure_penale"
  | "mixte"
  | "non_juridique";

interface TestQuestion {
  question: string;
  niveau: QuestionLevel;
  domaine: QuestionDomain;
  expectedCodes?: string[]; // Codes attendus
  expectedArticles?: string[]; // Articles attendus (pour validation)
}

interface ArticleResult {
  number: string;
  code: string;
  source: "concept" | "exact" | "vector" | "keyword" | "special_rule";
  similarity: number;
}

interface TestResult {
  question: string;
  niveau: QuestionLevel;
  domaine: QuestionDomain;
  isLegalQuestion: boolean;
  codesDetected: string[];
  conceptsMatched: string[];
  articlesFound: ArticleResult[];
  jurisprudenceFound: string[];
  responseTimeMs: number;
  timeout: boolean;
  success: boolean;
  error?: string;
}

// Test questions organized by level
const TEST_QUESTIONS: TestQuestion[] = [
  // NIVEAU L1 - Définitions basiques
  {
    question: "C'est quoi un contrat ?",
    niveau: "L1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 1101"],
  },
  {
    question: "Qu'est-ce qu'un CDI ?",
    niveau: "L1",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
    expectedArticles: ["Article L1221-1"],
  },
  {
    question: "C'est quoi le vol ?",
    niveau: "L1",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Qu'est-ce qu'une SARL ?",
    niveau: "L1",
    domaine: "commercial",
    expectedCodes: ["Code de commerce"],
    expectedArticles: ["Article L223-1"],
  },
  {
    question: "C'est quoi le divorce ?",
    niveau: "L1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 229"],
  },
  {
    question: "Qu'est-ce qu'un crime ?",
    niveau: "L1",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },

  // NIVEAU L2 - Régimes et conditions
  {
    question: "Quelles sont les conditions de validité d'un contrat ?",
    niveau: "L2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quels sont les effets de la nullité ?",
    niveau: "L2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quelles sont les causes d'exonération de responsabilité ?",
    niveau: "L2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quels sont les cas de licenciement pour motif personnel ?",
    niveau: "L2",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Quelles sont les conditions de la légitime défense ?",
    niveau: "L2",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Quels sont les éléments constitutifs de l'escroquerie ?",
    niveau: "L2",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Quelles sont les conditions du divorce pour faute ?",
    niveau: "L2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 229"],
  },

  // NIVEAU L3 - Articulation et comparaison
  {
    question: "Quelle est la différence entre nullité relative et nullité absolue ?",
    niveau: "L3",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Distinguez responsabilité contractuelle et délictuelle",
    niveau: "L3",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 1240"],
  },
  {
    question: "Quelle est la différence entre résolution et résiliation ?",
    niveau: "L3",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Comparez le CDI et le CDD",
    niveau: "L3",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Quelle est la distinction entre crime, délit et contravention ?",
    niveau: "L3",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Différence entre faute grave et faute lourde en droit du travail ?",
    niveau: "L3",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Distinguez l'erreur, le dol et la violence",
    niveau: "L3",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quelle est la différence entre meurtre et assassinat ?",
    niveau: "L3",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Comparez la garde à vue et la détention provisoire",
    niveau: "L3",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },
  {
    question: "Distinguez la responsabilité du fait personnel et du fait d'autrui",
    niveau: "L3",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 1240", "Article 1242"],
  },

  // NIVEAU M1 - Jurisprudence et évolutions
  {
    question: "Quel est l'apport de l'arrêt Chronopost ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Comment a évolué la jurisprudence sur la responsabilité du fait des choses ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 1242"],
  },
  {
    question: "Qu'est-ce que l'arrêt Jand'heur ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quel est l'impact de la réforme du droit des contrats de 2016 ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Comment la Cour de cassation apprécie-t-elle la faute grave ?",
    niveau: "M1",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Quelle est la portée de l'arrêt Perruche ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Qu'est-ce que la théorie de l'imprévision après la réforme ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Comment s'articulent la loi Badinter et le droit commun ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Qu'a changé l'arrêt Bertrand sur la responsabilité du fait d'autrui ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quel est l'apport de l'arrêt Costedoat sur l'immunité du préposé ?",
    niveau: "M1",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },

  // NIVEAU M2 - Questions complexes et transversales
  {
    question:
      "Comment s'articulent responsabilité pénale et civile en cas d'accident mortel de la circulation ?",
    niveau: "M2",
    domaine: "mixte",
    expectedCodes: ["Code civil", "Code pénal"],
  },
  {
    question: "Quelles sont les conséquences de la requalification d'un CDD en CDI ?",
    niveau: "M2",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Comment se calcule le préjudice économique en cas de décès de la victime ?",
    niveau: "M2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quelle est l'articulation entre action civile et action publique ?",
    niveau: "M2",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },
  {
    question: "Comment s'applique la prescription en matière d'abus de biens sociaux occulte ?",
    niveau: "M2",
    domaine: "mixte",
    expectedCodes: ["Code de commerce", "Code de procédure pénale"],
  },
  {
    question: "Quels sont les recours du salarié en cas de licenciement sans cause réelle et sérieuse ?",
    niveau: "M2",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Comment se répartit la responsabilité entre commettant et préposé ?",
    niveau: "M2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Quelle est la responsabilité des dirigeants sociaux en cas de procédure collective ?",
    niveau: "M2",
    domaine: "commercial",
    expectedCodes: ["Code de commerce"],
  },
  {
    question:
      "Comment s'articule le principe de non-cumul des responsabilités contractuelle et délictuelle ?",
    niveau: "M2",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question:
      "Quelles sont les exceptions au principe de l'autorité de la chose jugée au pénal sur le civil ?",
    niveau: "M2",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },

  // CAS PRATIQUES typiques
  {
    question: "Un salarié en CDI depuis 5 ans est licencié pour faute grave après un vol. Quels sont ses droits ?",
    niveau: "cas_pratique",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Une personne est blessée par un produit défectueux. Sur quel fondement peut-elle agir ?",
    niveau: "cas_pratique",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Un contrat a été signé sous la menace. Peut-il être annulé et dans quel délai ?",
    niveau: "cas_pratique",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Un associé de SARL veut céder ses parts. Quelle est la procédure ?",
    niveau: "cas_pratique",
    domaine: "commercial",
    expectedCodes: ["Code de commerce"],
  },
  {
    question: "Un conducteur renverse un piéton. Quelles responsabilités encourt-il ?",
    niveau: "cas_pratique",
    domaine: "mixte",
    expectedCodes: ["Code civil", "Code pénal"],
  },
  {
    question: "Un employeur ne paie pas les heures supplémentaires. Que peut faire le salarié ?",
    niveau: "cas_pratique",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Une entreprise est en cessation de paiement. Quelles procédures peuvent être ouvertes ?",
    niveau: "cas_pratique",
    domaine: "commercial",
    expectedCodes: ["Code de commerce"],
  },
  {
    question: "Un locataire ne paie plus son loyer depuis 3 mois. Comment le propriétaire peut-il réagir ?",
    niveau: "cas_pratique",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Un salarié est harcelé par son supérieur. Quels sont ses recours ?",
    niveau: "cas_pratique",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Un consommateur a acheté un bien défectueux. Quelles garanties peut-il invoquer ?",
    niveau: "cas_pratique",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },

  // QUESTIONS DE PROCÉDURE
  {
    question: "Quel est le délai pour contester un licenciement ?",
    niveau: "procedure",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Comment se déroule une garde à vue ?",
    niveau: "procedure",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },
  {
    question: "Quels sont les délais de prescription en matière civile ?",
    niveau: "procedure",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 2224"],
  },
  {
    question: "Comment saisir le conseil de prud'hommes ?",
    niveau: "procedure",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Quelle est la procédure de divorce par consentement mutuel ?",
    niveau: "procedure",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Comment se déroule l'instruction pénale ?",
    niveau: "procedure",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },
  {
    question: "Quel est le délai d'appel en matière civile ?",
    niveau: "procedure",
    domaine: "procedure_civile",
    expectedCodes: ["Code de procédure civile"],
  },
  {
    question: "Comment faire opposition à une ordonnance pénale ?",
    niveau: "procedure",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },
  {
    question: "Quel est le délai de prescription pour un délit ?",
    niveau: "procedure",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
    expectedArticles: ["Article 8"],
  },
  {
    question: "Comment contester un PV ?",
    niveau: "procedure",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
  },

  // QUESTIONS PIÈGES / FAUX POSITIFS
  {
    question: "Salut !",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Comment ça va ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Merci pour ta réponse",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Tu peux m'aider ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "C'est quoi la vie ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Quel temps fait-il ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Raconte-moi une blague",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Qui est le président de la République ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "C'est quoi sa voiture ?",
    niveau: "piege",
    domaine: "non_juridique",
  },
  {
    question: "Il a fait sa déclaration",
    niveau: "piege",
    domaine: "non_juridique",
  },

  // QUESTIONS AMBIGUËS (plusieurs domaines possibles)
  {
    question: "C'est quoi la prescription ?",
    niveau: "ambigue",
    domaine: "mixte",
  },
  {
    question: "Qu'est-ce que la responsabilité ?",
    niveau: "ambigue",
    domaine: "mixte",
  },
  {
    question: "C'est quoi la faute ?",
    niveau: "ambigue",
    domaine: "mixte",
  },
  {
    question: "Qu'est-ce qu'un contrat ?",
    niveau: "ambigue",
    domaine: "civil",
  },
  {
    question: "C'est quoi une société ?",
    niveau: "ambigue",
    domaine: "commercial",
  },
  {
    question: "Qu'est-ce que la nullité ?",
    niveau: "ambigue",
    domaine: "civil",
  },

  // QUESTIONS AVEC NUMÉROS D'ARTICLES
  {
    question: "Que dit l'article 1240 du Code civil ?",
    niveau: "article",
    domaine: "civil",
    expectedCodes: ["Code civil"],
    expectedArticles: ["Article 1240"],
  },
  {
    question: "C'est quoi l'article 121-3 du Code pénal ?",
    niveau: "article",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
    expectedArticles: ["Article 121-3"],
  },
  {
    question: "Que prévoit l'article L1232-1 du Code du travail ?",
    niveau: "article",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
    expectedArticles: ["Article L1232-1"],
  },
  {
    question: "Qu'est-ce que l'article 700 du Code de procédure civile ?",
    niveau: "article",
    domaine: "procedure_civile",
    expectedCodes: ["Code de procédure civile"],
  },
  {
    question: "Que dit l'article 1134 ancien du Code civil ?",
    niveau: "article",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "C'est quoi l'article 9 du Code de procédure pénale ?",
    niveau: "article",
    domaine: "procedure_penale",
    expectedCodes: ["Code de procédure pénale"],
    expectedArticles: ["Article 9"],
  },

  // QUESTIONS EN LANGAGE FAMILIER
  {
    question: "J'me suis fait virer, j'ai droit à quoi ?",
    niveau: "familier",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "Mon proprio veut m'expulser, il peut ?",
    niveau: "familier",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "J'ai tapé quelqu'un, je risque quoi ?",
    niveau: "familier",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Mon patron me harcèle, que faire ?",
    niveau: "familier",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
  {
    question: "On m'a arnaqué sur internet, c'est quoi comme infraction ?",
    niveau: "familier",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Mon ex veut la garde des enfants, comment ça marche ?",
    niveau: "familier",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "J'ai grillé un feu rouge, je risque quoi ?",
    niveau: "familier",
    domaine: "penal",
    expectedCodes: ["Code pénal"],
  },
  {
    question: "Mon voisin fait trop de bruit, que faire ?",
    niveau: "familier",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "J'ai signé un truc sans lire, je peux annuler ?",
    niveau: "familier",
    domaine: "civil",
    expectedCodes: ["Code civil"],
  },
  {
    question: "Mon employeur me doit de l'argent, comment je fais ?",
    niveau: "familier",
    domaine: "travail",
    expectedCodes: ["Code du travail"],
  },
];

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Check if question is legal (same logic as route.ts)
// BLACKLIST approach: by default, consider all questions as potentially legal
function isDefinitelyNotLegal(message: string): boolean {
  const lowerMsg = message.toLowerCase().trim();

  // 1. Messages trop courts (< 3 mots) qui sont des salutations
  const greetings = [
    "salut", "hello", "bonjour", "bonsoir", "coucou", "hey", "hi", "yo",
    "merci", "thanks", "thx", "ok", "d'accord", "dacord", "très bien", "parfait", "super", "cool", "génial",
    "au revoir", "bye", "à plus", "ciao", "tchao", "bonne journée", "bonne soirée"
  ];

  if (greetings.some(g => lowerMsg === g || lowerMsg === g + " !" || lowerMsg === g + " ?")) {
    return true;
  }

  // 2. Questions générales évidentes (non juridiques)
  const nonLegalPatterns = [
    /^(comment )?ça va/,
    /^tu vas bien/,
    /^quoi de neuf/,
    /quel temps fait/,
    /quelle heure/,
    /raconte.*(blague|histoire)/,
    /qui est (le |la )?(président|ministre|roi|reine)/,
    /c'est quoi (la vie|le bonheur|l'amour)\??$/,
    /^tu (peux|sais) (m'aider|faire)/,
    /^aide[- ]moi$/,
    /^j'ai (faim|soif|sommeil|froid|chaud)/,
    /^(quelle est )?ta? (couleur|film|musique|chanson) préféré/,
    /^qui es-tu/,
    /^tu t'appelles comment/,
    /^comment tu fonctionnes/,
    /^présente-toi/,
  ];

  if (nonLegalPatterns.some(p => p.test(lowerMsg))) {
    return true;
  }

  // 3. Messages de remerciement/politesse pure
  if (/^(merci|thanks|thx)( beaucoup| bien| pour)?( !)?$/i.test(lowerMsg)) {
    return true;
  }

  // 4. Tout le reste → considéré comme POTENTIELLEMENT juridique
  return false;
}

// Wrapper for backward compatibility
function isLegalQuestion(message: string): boolean {
  return !isDefinitelyNotLegal(message);
}

// Detect relevant codes (same logic as route.ts)
function detectRelevantCodes(message: string): string[] | null {
  const lowerMsg = message.toLowerCase();
  const codes: Set<string> = new Set();

  const codeDetection: Record<string, string[]> = {
    "Code civil": [
      "civil",
      "mariage",
      "divorce",
      "responsabilité délictuelle",
      "responsabilité civile",
      "contrat",
      "obligation",
      "succession",
      "propriété",
      "1240",
      "1241",
      "2224",
      "consentement",
      "dol",
      "erreur",
      "violence",
      "préjudice",
      "dommage",
      "réparation",
    ],
    "Code pénal": [
      "pénal",
      "penal",
      "crime",
      "délit",
      "infraction",
      "peine",
      "amende",
      "prison",
      "vol",
      "meurtre",
      "abus de confiance",
      "escroquerie",
      "314-1",
      "311-1",
      "homicide",
    ],
    "Code du travail": [
      "travail",
      "cdi",
      "cdd",
      "licenciement",
      "salarié",
      "employeur",
      "salaire",
      "contrat de travail",
      "préavis",
      "prud'hom",
      "démission",
      "rupture conventionnelle",
      "faute grave",
      "faute lourde",
      "indemnité",
    ],
    "Code de commerce": [
      "commerce",
      "commercial",
      "sarl",
      "sas",
      "société",
      "entreprise",
      "faillite",
      "dirigeant",
      "abus de biens sociaux",
      "L241",
      "L242",
      "L223",
      "L225",
    ],
    "Code de procédure pénale": [
      "procédure pénale",
      "prescription",
      "garde à vue",
      "instruction",
      "enquête",
      "action publique",
      "article 7",
      "article 8",
      "article 9",
    ],
    "Code de procédure civile": [
      "procédure civile",
      "assignation",
      "appel",
      "tribunal judiciaire",
      "référé",
    ],
  };

  for (const [codeName, keywords] of Object.entries(codeDetection)) {
    if (keywords.some((kw) => lowerMsg.includes(kw))) {
      codes.add(codeName);
    }
  }

  if (codes.size === 0) return null;
  return Array.from(codes);
}

// Detect matched concepts
function detectMatchedConcepts(message: string): string[] {
  const lowerMsg = message.toLowerCase();
  const matched: string[] = [];

  for (const [conceptName, conceptData] of Object.entries(LEGAL_CONCEPTS)) {
    if (lowerMsg.includes(conceptName.toLowerCase())) {
      matched.push(conceptName);
    } else {
      for (const keyword of conceptData.keywords) {
        if (lowerMsg.includes(keyword.toLowerCase())) {
          matched.push(conceptName);
          break;
        }
      }
    }
  }

  return Array.from(new Set(matched));
}

// Extract article number from question
function extractArticleNumber(message: string): string | null {
  const patterns = [/\barticle\s+(\d+(?:[.-]\d+)*)/i, /\bart\.?\s+(\d+(?:[.-]\d+)*)/i];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Extract code name from question
function extractCodeName(message: string): string | null {
  const lowerMessage = message.toLowerCase();

  const codeMapping: Record<string, string> = {
    "code de procédure pénale": "Code de procédure pénale",
    "code de procedure penale": "Code de procédure pénale",
    "procédure pénale": "Code de procédure pénale",
    "procedure penale": "Code de procédure pénale",
    "cpp": "Code de procédure pénale",
    "code de procédure civile": "Code de procédure civile",
    "code de procedure civile": "Code de procédure civile",
    "procédure civile": "Code de procédure civile",
    "procedure civile": "Code de procédure civile",
    "cpc": "Code de procédure civile",
    "code civil": "Code civil",
    "code civ": "Code civil",
    "cc": "Code civil",
    "code pénal": "Code pénal",
    "code penal": "Code pénal",
    "code du travail": "Code du travail",
    "code travail": "Code du travail",
    "code de commerce": "Code de commerce",
    "code commerce": "Code de commerce",
  };

  for (const [pattern, codeName] of Object.entries(codeMapping)) {
    if (lowerMessage.includes(pattern)) {
      return codeName;
    }
  }

  return null;
}

// Test a single question
async function testQuestion(testQuestion: TestQuestion): Promise<TestResult> {
  const startTime = Date.now();
  const { question, niveau, domaine } = testQuestion;

  const result: TestResult = {
    question,
    niveau,
    domaine,
    isLegalQuestion: isLegalQuestion(question),
    codesDetected: [],
    conceptsMatched: [],
    articlesFound: [],
    jurisprudenceFound: [],
    responseTimeMs: 0,
    timeout: false,
    success: false,
  };

  try {
    // Skip RAG if not a legal question
    if (!result.isLegalQuestion) {
      result.responseTimeMs = Date.now() - startTime;
      result.success = niveau === "piege"; // Success if correctly identified as non-legal
      return result;
    }

    // Detect codes
    const codesDetected = detectRelevantCodes(question);
    result.codesDetected = codesDetected || [];

    // Detect concepts
    result.conceptsMatched = detectMatchedConcepts(question);

    // STEP 1: Exact article search
    const articleNumber = extractArticleNumber(question);
    const codeName = extractCodeName(question);

    if (articleNumber) {
      let query = supabase
        .from("law_articles")
        .select("id, code_name, article_number, content, source_url")
        .ilike("article_number", `%${articleNumber}%`);

      if (codeName) {
        query = query.eq("code_name", codeName);
      }

      const { data: exactMatches } = await query.limit(3);

      if (exactMatches && exactMatches.length > 0) {
        result.articlesFound.push(
          ...exactMatches.map((a: any) => ({
            number: a.article_number,
            code: a.code_name,
            source: "exact" as const,
            similarity: 1.0,
          }))
        );
      }
    }

    // STEP 2: Concept-based search
    if (result.conceptsMatched.length > 0) {
      for (const conceptName of result.conceptsMatched) {
        const conceptData = LEGAL_CONCEPTS[conceptName];

        for (const articleGroup of conceptData.articles) {
          const { code, numbers } = articleGroup;

          const { data: conceptArticles } = await supabase
            .from("law_articles")
            .select("id, code_name, article_number, content, source_url")
            .eq("code_name", code)
            .in("article_number", numbers);

          if (conceptArticles && conceptArticles.length > 0) {
            result.articlesFound.push(
              ...conceptArticles.map((a: any) => ({
                number: a.article_number,
                code: a.code_name,
                source: "concept" as const,
                similarity: 0.98,
              }))
            );
          }
        }
      }
    }

    // STEP 3: Vector search
    const queryEmbedding = await generateEmbedding(question);

    const timeoutMs = codesDetected ? 3000 : 8000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("SEARCH_TIMEOUT")), timeoutMs);
    });

    const articlesPromise = supabase.rpc("match_law_articles_filtered", {
      query_embedding: queryEmbedding,
      match_threshold: 0.4,
      match_count: 5,
      filter_codes: codesDetected,
    });

    const jurisprudencePromise = supabase.rpc("match_court_decisions", {
      query_embedding: queryEmbedding,
      match_threshold: 0.45,
      match_count: 2,
    });

    try {
      const [articlesResult, jurisprudenceResult] = await Promise.race([
        Promise.all([articlesPromise, jurisprudencePromise]),
        timeoutPromise,
      ]);

      if (!articlesResult.error && articlesResult.data) {
        result.articlesFound.push(
          ...articlesResult.data.map((a: any) => ({
            number: a.article_number,
            code: a.code_name,
            source: "vector" as const,
            similarity: a.similarity,
          }))
        );
      }

      if (!jurisprudenceResult.error && jurisprudenceResult.data) {
        result.jurisprudenceFound = jurisprudenceResult.data.map((j: any) => j.case_number);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "SEARCH_TIMEOUT") {
        result.timeout = true;
      } else {
        throw error;
      }
    }

    // Deduplicate articles
    const uniqueArticles = new Map<string, ArticleResult>();
    for (const article of result.articlesFound) {
      const key = `${article.code}:${article.number}`;
      if (!uniqueArticles.has(key) || uniqueArticles.get(key)!.similarity < article.similarity) {
        uniqueArticles.set(key, article);
      }
    }
    result.articlesFound = Array.from(uniqueArticles.values()).slice(0, 5);

    // Success if at least 1 article found
    result.success = result.articlesFound.length > 0;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.success = false;
  }

  result.responseTimeMs = Date.now() - startTime;
  return result;
}

// Generate statistics
function generateStatistics(results: TestResult[]) {
  const stats = {
    total: results.length,
    success: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    timeout: results.filter((r) => r.timeout).length,
    errors: results.filter((r) => r.error).length,
    avgResponseTime: Math.round(
      results.reduce((sum, r) => sum + r.responseTimeMs, 0) / results.length
    ),
    byLevel: {} as Record<QuestionLevel, { total: number; success: number; avgTime: number }>,
    byDomain: {} as Record<QuestionDomain, { total: number; success: number; avgTime: number }>,
    topSlowest: results.sort((a, b) => b.responseTimeMs - a.responseTimeMs).slice(0, 10),
    failed: results.filter((r) => !r.success && r.isLegalQuestion),
    falsePositives: results.filter((r) => r.isLegalQuestion && r.niveau === "piege"),
    falseNegatives: results.filter((r) => !r.isLegalQuestion && r.niveau !== "piege"),
  };

  // Stats by level
  const levels = Array.from(new Set(results.map((r) => r.niveau)));
  for (const level of levels) {
    const levelResults = results.filter((r) => r.niveau === level);
    stats.byLevel[level] = {
      total: levelResults.length,
      success: levelResults.filter((r) => r.success).length,
      avgTime: Math.round(
        levelResults.reduce((sum, r) => sum + r.responseTimeMs, 0) / levelResults.length
      ),
    };
  }

  // Stats by domain
  const domains = Array.from(new Set(results.map((r) => r.domaine)));
  for (const domain of domains) {
    const domainResults = results.filter((r) => r.domaine === domain);
    stats.byDomain[domain] = {
      total: domainResults.length,
      success: domainResults.filter((r) => r.success).length,
      avgTime: Math.round(
        domainResults.reduce((sum, r) => sum + r.responseTimeMs, 0) / domainResults.length
      ),
    };
  }

  return stats;
}

// Generate Markdown report
function generateMarkdownReport(results: TestResult[], stats: any): string {
  const timestamp = new Date().toISOString();

  let report = `# Test RAG Complet - Rapport\n\n`;
  report += `**Date:** ${timestamp}\n\n`;
  report += `**Total de questions testées:** ${stats.total}\n\n`;

  report += `## 📊 Résultats Globaux\n\n`;
  report += `- ✅ **Succès:** ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)\n`;
  report += `- ❌ **Échecs:** ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)\n`;
  report += `- ⏱️ **Timeouts:** ${stats.timeout}\n`;
  report += `- 🐛 **Erreurs:** ${stats.errors}\n`;
  report += `- ⚡ **Temps moyen de réponse:** ${stats.avgResponseTime}ms\n\n`;

  report += `## 📚 Résultats par Niveau\n\n`;
  report += `| Niveau | Total | Succès | Taux | Temps moyen |\n`;
  report += `|--------|-------|--------|------|-------------|\n`;
  for (const [level, data] of Object.entries(stats.byLevel)) {
    const d = data as any;
    report += `| ${level} | ${d.total} | ${d.success} | ${((d.success / d.total) * 100).toFixed(1)}% | ${d.avgTime}ms |\n`;
  }
  report += `\n`;

  report += `## 🏛️ Résultats par Domaine\n\n`;
  report += `| Domaine | Total | Succès | Taux | Temps moyen |\n`;
  report += `|---------|-------|--------|------|-------------|\n`;
  for (const [domain, data] of Object.entries(stats.byDomain)) {
    const d = data as any;
    report += `| ${domain} | ${d.total} | ${d.success} | ${((d.success / d.total) * 100).toFixed(1)}% | ${d.avgTime}ms |\n`;
  }
  report += `\n`;

  report += `## 🐌 Top 10 des Questions les Plus Lentes\n\n`;
  report += `| Question | Niveau | Temps | Timeout |\n`;
  report += `|----------|--------|-------|----------|\n`;
  for (const result of stats.topSlowest) {
    report += `| ${result.question.substring(0, 60)}... | ${result.niveau} | ${result.responseTimeMs}ms | ${result.timeout ? "⏱️" : ""} |\n`;
  }
  report += `\n`;

  if (stats.failed.length > 0) {
    report += `## ❌ Échecs (Questions Juridiques Sans Résultat)\n\n`;
    report += `**Total:** ${stats.failed.length}\n\n`;
    for (const result of stats.failed) {
      report += `### ${result.question}\n`;
      report += `- **Niveau:** ${result.niveau}\n`;
      report += `- **Domaine:** ${result.domaine}\n`;
      report += `- **Codes détectés:** ${result.codesDetected.join(", ") || "Aucun"}\n`;
      report += `- **Concepts matchés:** ${result.conceptsMatched.join(", ") || "Aucun"}\n`;
      report += `- **Articles trouvés:** ${result.articlesFound.length}\n`;
      report += `- **Timeout:** ${result.timeout ? "Oui" : "Non"}\n`;
      if (result.error) {
        report += `- **Erreur:** ${result.error}\n`;
      }
      report += `\n`;
    }
  }

  if (stats.falsePositives.length > 0) {
    report += `## ⚠️ Faux Positifs Détectés\n\n`;
    report += `**Total:** ${stats.falsePositives.length}\n\n`;
    for (const result of stats.falsePositives) {
      report += `- "${result.question}" → Identifié comme juridique alors que c'est un piège\n`;
    }
    report += `\n`;
  }

  if (stats.falseNegatives.length > 0) {
    report += `## ⚠️ Faux Négatifs Détectés\n\n`;
    report += `**Total:** ${stats.falseNegatives.length}\n\n`;
    for (const result of stats.falseNegatives) {
      report += `- "${result.question}" → Non identifié comme juridique\n`;
    }
    report += `\n`;
  }

  report += `## 💡 Recommandations\n\n`;
  const failedConcepts = stats.failed
    .filter((r: TestResult) => r.conceptsMatched.length === 0 && r.articlesFound.length === 0)
    .map((r: TestResult) => r.question);

  if (failedConcepts.length > 0) {
    report += `### Concepts à ajouter\n\n`;
    report += `Les questions suivantes pourraient bénéficier de nouveaux concepts dans l'index :\n\n`;
    for (const q of failedConcepts.slice(0, 10)) {
      report += `- ${q}\n`;
    }
    report += `\n`;
  }

  const slowQuestions = stats.topSlowest.filter((r: TestResult) => r.responseTimeMs > 5000);
  if (slowQuestions.length > 0) {
    report += `### Optimisation des Performances\n\n`;
    report += `${slowQuestions.length} questions dépassent 5 secondes. Considérer :\n`;
    report += `- Améliorer la détection des codes pour plus de filtrage\n`;
    report += `- Ajouter plus de concepts pour les questions fréquentes\n`;
    report += `- Optimiser les embeddings\n\n`;
  }

  if (stats.timeout > 0) {
    report += `### Timeouts\n\n`;
    report += `${stats.timeout} questions ont timeout. Considérer :\n`;
    report += `- Augmenter le timeout pour les recherches sans filtre\n`;
    report += `- Optimiser les requêtes Supabase\n\n`;
  }

  return report;
}

// Main test function
async function runTests() {
  console.log("🚀 Démarrage des tests RAG complets...\n");
  console.log(`📝 Total de questions à tester: ${TEST_QUESTIONS.length}\n`);

  const results: TestResult[] = [];

  for (let i = 0; i < TEST_QUESTIONS.length; i++) {
    const questionData = TEST_QUESTIONS[i];
    console.log(
      `[${i + 1}/${TEST_QUESTIONS.length}] Testing: ${questionData.question.substring(0, 60)}...`
    );

    const result = await testQuestion(questionData);
    results.push(result);

    // Log result summary
    const status = result.success ? "✅" : "❌";
    console.log(
      `  ${status} ${result.articlesFound.length} articles | ${result.responseTimeMs}ms | Concepts: ${result.conceptsMatched.length}`
    );

    if (result.timeout) {
      console.log("  ⏱️  TIMEOUT");
    }
    if (result.error) {
      console.log(`  🐛 ERROR: ${result.error}`);
    }
  }

  console.log("\n📊 Génération des statistiques...\n");
  const stats = generateStatistics(results);

  console.log("📝 Génération du rapport...\n");
  const markdownReport = generateMarkdownReport(results, stats);

  // Create reports directory if it doesn't exist
  const reportsDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Generate filenames with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const jsonFilename = `rag-test-${timestamp}.json`;
  const mdFilename = `rag-test-${timestamp}.md`;

  // Write JSON results
  const jsonPath = path.join(reportsDir, jsonFilename);
  fs.writeFileSync(jsonPath, JSON.stringify({ results, stats }, null, 2));
  console.log(`✅ Résultats JSON sauvegardés: ${jsonPath}`);

  // Write Markdown report
  const mdPath = path.join(reportsDir, mdFilename);
  fs.writeFileSync(mdPath, markdownReport);
  console.log(`✅ Rapport Markdown sauvegardé: ${mdPath}`);

  console.log("\n" + "=".repeat(60));
  console.log("📊 RÉSUMÉ DES TESTS");
  console.log("=".repeat(60));
  console.log(`Total: ${stats.total}`);
  console.log(`Succès: ${stats.success} (${((stats.success / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Échecs: ${stats.failed} (${((stats.failed / stats.total) * 100).toFixed(1)}%)`);
  console.log(`Timeouts: ${stats.timeout}`);
  console.log(`Erreurs: ${stats.errors}`);
  console.log(`Temps moyen: ${stats.avgResponseTime}ms`);
  console.log("=".repeat(60) + "\n");
}

// Run tests
runTests().catch((error) => {
  console.error("❌ Erreur fatale:", error);
  process.exit(1);
});
