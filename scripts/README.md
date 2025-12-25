# Scripts d'import Nomo

Ce dossier contient les scripts pour importer les données juridiques dans la base de données Supabase.

## Scripts disponibles

### 1. Import du Code civil (`import-codes.ts`)

Importe les articles du Code civil depuis un fichier JSON local.

```bash
npm run import:codes
```

### 2. Import de la jurisprudence Judilibre (`import-judilibre.ts`)

Importe les décisions de la Cour de cassation depuis l'API Judilibre.

```bash
npm run import:judilibre
```

## Configuration requise

### Variables d'environnement

Assurez-vous que votre fichier `.env.local` contient :

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Mistral AI (pour les embeddings)
MISTRAL_API_KEY=your_mistral_api_key

# PISTE (pour Judilibre)
PISTE_CLIENT_ID=your_piste_client_id
PISTE_CLIENT_SECRET=your_piste_client_secret
```

### Obtenir les credentials PISTE

1. Créer un compte sur [PISTE (Portail d'Interopérabilité des Services du Travail, de l'Emploi)](https://piste.gouv.fr)
2. Créer une application OAuth2
3. Obtenir le `client_id` et `client_secret`
4. Ajouter les permissions pour l'API Judilibre

## Préparation de la base de données

### Pour l'import Judilibre

Avant de lancer le script d'import Judilibre, vous devez créer la table `court_decisions` dans Supabase :

1. Ouvrir le SQL Editor dans Supabase
2. Exécuter le script `scripts/create-court-decisions-table.sql`

Ce script va créer :
- La table `court_decisions` avec tous les champs nécessaires
- Les index pour améliorer les performances
- L'index vectoriel pour la recherche sémantique
- La fonction `match_court_decisions()` pour rechercher par similarité
- Les politiques RLS pour la sécurité

### Structure de la table court_decisions

| Champ | Type | Description |
|-------|------|-------------|
| id | UUID | Identifiant unique |
| decision_id | TEXT | ID Judilibre (unique) |
| numero | TEXT | Numéro de décision |
| juridiction | TEXT | Juridiction (ex: Cour de cassation) |
| chambre | TEXT | Chambre (civile, commerciale, sociale, criminelle) |
| formation | TEXT | Formation de jugement |
| date_decision | DATE | Date de la décision |
| solution | TEXT | Solution (cassation, rejet, etc.) |
| resume | TEXT | Résumé de la décision |
| sommaire | TEXT | Sommaire |
| texte_integral | TEXT | Texte intégral de la décision |
| publication | TEXT[] | Type de publication (Bulletin, Rapport, Communiqué) |
| ecli | TEXT | Identifiant ECLI européen |
| source_url | TEXT | URL vers la décision |
| embedding | vector(1024) | Embedding pour la recherche sémantique |

## Détails des scripts

### import-judilibre.ts

Ce script :
- S'authentifie via OAuth2 avec PISTE
- Récupère les décisions de la Cour de cassation (2015-2024)
- Filtre par chambre : civile, commerciale, sociale, criminelle
- Ne récupère que les décisions importantes (publiées au Bulletin, Rapport, ou Communiqué)
- Génère un embedding pour chaque décision
- Insère les données dans la table `court_decisions`
- Respecte un rate limiting de 1 requête/seconde
- Limite à 1000 décisions par défaut (modifiable dans le code)

#### Paramètres modifiables

Dans le fichier `import-judilibre.ts`, vous pouvez ajuster :

```typescript
const RATE_LIMIT_DELAY = 1000; // Délai entre les requêtes (ms)
const MAX_DECISIONS = 1000; // Nombre max de décisions à importer
const PAGE_SIZE = 10; // Nombre de résultats par page
```

#### Filtres de recherche

Le script utilise les paramètres suivants pour l'API Judilibre :

```typescript
{
  query: "chambre:(civile OR commerciale OR sociale OR criminelle)",
  date_start: "2015-01-01",
  date_end: "2024-12-31",
  publication: ["b", "r", "c"], // b=Bulletin, r=Rapport, c=Communiqué
  sort: "date",
  order: "desc"
}
```

## API Judilibre

### Endpoints utilisés

- **POST** `/search` : Rechercher des décisions
- **GET** `/decision` : Récupérer une décision complète

### Documentation

Documentation complète de l'API Judilibre :
https://api.piste.gouv.fr/cassation/judilibre/v1.0/docs

## Monitoring et logs

Les scripts affichent des logs détaillés :
- 🔐 Authentification PISTE
- 📥 Progression de l'import
- ✅ Succès d'import
- ❌ Erreurs rencontrées
- 📊 Statistiques finales

Exemple de sortie :
```
🔐 Authenticating with PISTE...
✅ Authentication successful

📥 Starting import of up to 1000 decisions...

📄 Fetching page 1...
Found 10 decisions (total: 15243)

[1/1000] Processing decision 12-34567...
[1/1000] ✅ Imported 12-34567
...
--- Import Complete ---
✅ Success: 998
❌ Errors: 2
📊 Total processed: 1000
```

## Dépannage

### Erreur d'authentification PISTE

Vérifiez que :
- Les credentials PISTE sont corrects dans `.env.local`
- Votre application PISTE a les permissions pour Judilibre
- Les credentials n'ont pas expiré

### Erreur de base de données

Vérifiez que :
- La table `court_decisions` existe
- Les permissions Supabase sont correctes
- La clé Supabase est valide

### Erreur d'embedding

Vérifiez que :
- La clé Mistral API est valide
- Vous n'avez pas dépassé les quotas Mistral

### Rate limiting

Si vous voyez des erreurs 429 (Too Many Requests), augmentez le `RATE_LIMIT_DELAY` dans le script.
