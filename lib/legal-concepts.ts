export const LEGAL_CONCEPTS: Record<string, {
  articles: { code: string; numbers: string[] }[];
  keywords: string[];
}> = {
  // DROIT CIVIL
  "responsabilité délictuelle": {
    articles: [
      { code: "Code civil", numbers: ["Article 1240", "Article 1241", "Article 1242", "Article 1243", "Article 1244"] }
    ],
    keywords: ["responsabilité civile", "fait dommageable", "faute", "dommage", "réparation"]
  },
  "vices du consentement": {
    articles: [
      { code: "Code civil", numbers: ["Article 1130", "Article 1131", "Article 1132", "Article 1133", "Article 1137", "Article 1139", "Article 1140"] }
    ],
    keywords: ["erreur", "dol", "violence", "consentement"]
  },
  "prescription civile": {
    articles: [
      { code: "Code civil", numbers: ["Article 2224", "Article 2225", "Article 2226", "Article 2230", "Article 2231"] }
    ],
    keywords: ["délai", "prescription", "forclusion"]
  },
  "divorce": {
    articles: [
      { code: "Code civil", numbers: ["Article 229", "Article 229-1", "Article 229-2", "Article 229-3", "Article 230", "Article 231", "Article 232"] }
    ],
    keywords: ["séparation", "mariage", "dissolution", "consentement mutuel", "faute"]
  },
  "contrat": {
    articles: [
      { code: "Code civil", numbers: ["Article 1101", "Article 1102", "Article 1103", "Article 1104", "Article 1105"] }
    ],
    keywords: ["convention", "obligation", "accord", "parties"]
  },
  "caducité": {
    articles: [
      { code: "Code civil", numbers: ["Article 1186", "Article 1187"] }
    ],
    keywords: ["caducité", "contrats interdépendants", "ensemble contractuel", "contrats liés", "disparition", "anéantissement"]
  },
  "contrats interdépendants": {
    articles: [
      { code: "Code civil", numbers: ["Article 1186", "Article 1187", "Article 1189"] }
    ],
    keywords: ["interdépendants", "ensemble contractuel", "opération globale", "contrats liés", "indivisibilité"]
  },

  // DROIT DU TRAVAIL
  "cdi": {
    articles: [
      { code: "Code du travail", numbers: ["Article L1221-1", "Article L1221-2", "Article L1231-1", "Article L1232-1"] }
    ],
    keywords: ["contrat à durée indéterminée", "contrat de travail", "embauche"]
  },
  "cdd": {
    articles: [
      { code: "Code du travail", numbers: ["Article L1241-1", "Article L1242-1", "Article L1242-2", "Article L1243-1"] }
    ],
    keywords: ["contrat à durée déterminée", "terme", "renouvellement"]
  },
  "licenciement": {
    articles: [
      { code: "Code du travail", numbers: ["Article L1232-1", "Article L1232-2", "Article L1234-1", "Article L1234-9"] }
    ],
    keywords: ["rupture", "préavis", "indemnité", "motif"]
  },
  "faute grave": {
    articles: [
      { code: "Code du travail", numbers: ["Article L1234-1", "Article L1234-5", "Article L1234-9"] }
    ],
    keywords: ["licenciement", "faute lourde", "faute simple", "préavis"]
  },

  // DROIT PÉNAL
  "abus de confiance": {
    articles: [
      { code: "Code pénal", numbers: ["Article 314-1", "Article 314-2", "Article 314-3"] }
    ],
    keywords: ["détournement", "bien remis", "préjudice"]
  },
  "abus de biens sociaux": {
    articles: [
      { code: "Code de commerce", numbers: ["Article L241-3", "Article L242-6"] },
      { code: "Code de procédure pénale", numbers: ["Article 7", "Article 8", "Article 9"] }
    ],
    keywords: ["dirigeant", "société", "intérêt personnel", "prescription"]
  },
  "prescription pénale": {
    articles: [
      { code: "Code de procédure pénale", numbers: ["Article 7", "Article 8", "Article 9", "Article 9-1"] }
    ],
    keywords: ["crime", "délit", "contravention", "action publique"]
  },
  "responsabilité pénale": {
    articles: [
      { code: "Code pénal", numbers: ["Article 121-1", "Article 121-2", "Article 121-3"] }
    ],
    keywords: ["responsabilité pénale", "pénalement responsable", "auteur de l'infraction"]
  },
  "homicide involontaire": {
    articles: [
      { code: "Code pénal", numbers: ["Article 221-6", "Article 221-6-1", "Article 221-6-2"] }
    ],
    keywords: ["homicide involontaire", "mort involontaire", "causé la mort par imprudence"]
  },
  "blessures involontaires": {
    articles: [
      { code: "Code pénal", numbers: ["Article 222-19", "Article 222-20", "Article 222-21"] }
    ],
    keywords: ["blessures involontaires", "blessé par imprudence", "coups involontaires"]
  },
  "accident": {
    articles: [
      { code: "Code civil", numbers: ["Article 1240", "Article 1241", "Article 1242"] },
      { code: "Code pénal", numbers: ["Article 221-6", "Article 222-19", "Article 222-20"] }
    ],
    keywords: ["accident de la route", "accident de la circulation", "accident du travail", "accident mortel"]
  },

  // DROIT COMMERCIAL
  "sarl": {
    articles: [
      { code: "Code de commerce", numbers: ["Article L223-1", "Article L223-2", "Article L223-3", "Article L223-7"] }
    ],
    keywords: ["société à responsabilité limitée", "associés", "parts sociales", "gérant"]
  },
  "société anonyme": {
    articles: [
      { code: "Code de commerce", numbers: ["Article L225-1", "Article L225-2", "Article L225-17"] }
    ],
    keywords: ["société anonyme", "une sa", "la sa", "les sa", "actionnaires", "conseil d'administration"]
  },
  "sas": {
    articles: [
      { code: "Code de commerce", numbers: ["Article L227-1", "Article L227-2", "Article L227-5", "Article L227-6"] }
    ],
    keywords: ["société par actions simplifiée", "président", "statuts"]
  }
};
