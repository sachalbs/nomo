// @ts-nocheck
/**
 * Bulk Import of Jurisprudence from Judilibre API (PISTE)
 *
 * Imports ~30-50k relevant court decisions for law students (L2-M2)
 *
 * Priority:
 * 1. Published in Bulletin (most important)
 * 2. Recent decisions (last 5 years)
 * 3. By chamber (civil, commercial, social, criminal)
 *
 * Usage: npx tsx scripts/import-judilibre-bulk.ts [--resume] [--chamber <name>] [--limit <n>]
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

// ============================================================================
// CONFIGURATION
// ============================================================================

const JUDILIBRE_BASE = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0';
const MISTRAL_API_URL = 'https://api.mistral.ai/v1/embeddings';

const RATE_LIMIT_DELAY = 300; // 300ms between API requests
const EMBEDDING_DELAY = 200; // 200ms between embedding requests
const PAGE_SIZE = 50; // Max 50 per page (API limit)
const MAX_PAGES_PER_FILTER = 1000; // Max 50k per filter (1000 pages * 50)
const PROGRESS_FILE = 'data/judilibre-progress.json';

// Chambers to import (in priority order)
// Valid chamber codes: pl, mi, civ1, civ2, civ3, comm, soc, cr, creun, ordo, allciv, other
const CHAMBERS = [
  { id: 'civ1', name: 'Première chambre civile', priority: 1 },
  { id: 'civ2', name: 'Deuxième chambre civile', priority: 1 },
  { id: 'civ3', name: 'Troisième chambre civile', priority: 1 },
  { id: 'comm', name: 'Chambre commerciale', priority: 2 },
  { id: 'soc', name: 'Chambre sociale', priority: 2 },
  { id: 'cr', name: 'Chambre criminelle', priority: 3 },
];

// ============================================================================
// TYPES
// ============================================================================

interface JudilibreDecision {
  id: string;
  jurisdiction: string;
  chamber: string;
  number: string;
  ecli: string;
  decision_date: string;
  solution: string;
  publication: string[];
  themes: string[];
  summary: string;
  text: string;
}

interface JudilibreResponse {
  results: JudilibreDecision[];
  total: number;
  next_page: number | null;
}

interface ImportProgress {
  bulletin: { page: number; completed: boolean };
  chambers: Record<string, { page: number; completed: boolean }>;
  totalImported: number;
  lastRun: string;
}

interface ImportStats {
  total: number;
  inserted: number;
  skipped: number;
  errors: number;
}

// ============================================================================
// UTILITIES
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProgress(): ImportProgress {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  }
  return {
    bulletin: { page: 0, completed: false },
    chambers: {},
    totalImported: 0,
    lastRun: new Date().toISOString(),
  };
}

function saveProgress(progress: ImportProgress): void {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function truncateText(text: string, maxLength: number = 8000): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// ============================================================================
// JUDILIBRE API
// ============================================================================

async function fetchDecisions(params: {
  publication?: string[];
  chamber?: string;
  date_start?: string;
  date_end?: string;
  page?: number;
  page_size?: number;
}): Promise<JudilibreResponse> {
  const apiKey = process.env.PISTE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing PISTE_API_KEY');
  }

  // Build query string manually to handle arrays correctly
  // Arrays need to be repeated: publication=b&publication=r (not publication=b,r)
  const queryParts: string[] = [];

  queryParts.push(`page_size=${params.page_size || PAGE_SIZE}`);
  queryParts.push(`page=${params.page || 0}`);

  // Handle publication array - repeat parameter for each value
  if (params.publication && params.publication.length > 0) {
    for (const pub of params.publication) {
      queryParts.push(`publication=${encodeURIComponent(pub)}`);
    }
  }

  if (params.chamber) {
    queryParts.push(`chamber=${encodeURIComponent(params.chamber)}`);
  }
  if (params.date_start) {
    queryParts.push(`date_start=${encodeURIComponent(params.date_start)}`);
  }
  if (params.date_end) {
    queryParts.push(`date_end=${encodeURIComponent(params.date_end)}`);
  }

  const url = `${JUDILIBRE_BASE}/search?${queryParts.join('&')}`;

  const response = await fetch(url, {
    headers: {
      'KeyId': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Judilibre API error: ${response.status} - ${error}`);
  }

  return response.json();
}

async function fetchDecisionDetails(id: string): Promise<JudilibreDecision | null> {
  const apiKey = process.env.PISTE_API_KEY;
  if (!apiKey) {
    throw new Error('Missing PISTE_API_KEY');
  }

  try {
    const response = await fetch(`${JUDILIBRE_BASE}/decision?id=${id}`, {
      headers: {
        'KeyId': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch decision ${id}: ${response.status}`);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error(`Error fetching decision ${id}:`, error);
    return null;
  }
}

// ============================================================================
// MISTRAL EMBEDDINGS
// ============================================================================

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Missing MISTRAL_API_KEY');
  }

  const truncated = truncateText(text, 8000);

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: [truncated],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function generateEmbeddingWithRetry(text: string, maxRetries = 3): Promise<number[]> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('429') && i < maxRetries - 1) {
        const wait = 2000 * (i + 1);
        console.log(`   Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// ============================================================================
// DATABASE
// ============================================================================

async function insertDecision(
  supabase: any,
  decision: JudilibreDecision
): Promise<'inserted' | 'skipped' | 'error'> {
  try {
    // Check if already exists
    const { data: existing } = await supabase
      .from('court_decisions')
      .select('id')
      .eq('case_number', decision.number)
      .single();

    if (existing) {
      return 'skipped';
    }

    // Build summary text for embedding
    const summaryText = decision.summary || decision.text?.substring(0, 2000) || '';
    if (!summaryText || summaryText.length < 50) {
      return 'skipped';
    }

    // Generate embedding
    await sleep(EMBEDDING_DELAY);
    const embedding = await generateEmbeddingWithRetry(summaryText);

    // Determine importance
    const importance = decision.publication?.includes('b') ? 'important' : 'courant';

    // Map API chamber codes to French names
    const chamberMap: Record<string, string> = {
      'civ1': 'Première chambre civile',
      'civ2': 'Deuxième chambre civile',
      'civ3': 'Troisième chambre civile',
      'comm': 'Chambre commerciale',
      'soc': 'Chambre sociale',
      'cr': 'Chambre criminelle',
      'pl': 'Assemblée plénière',
      'mi': 'Chambre mixte',
      'creun': 'Chambres réunies',
      'ordo': 'Ordonnance',
      'allciv': 'Toutes chambres civiles',
    };

    // Insert
    const { error: insertError } = await supabase.from('court_decisions').insert({
      case_number: decision.number,
      jurisdiction: decision.jurisdiction || 'Cour de cassation',
      chambre: chamberMap[decision.chamber] || decision.chamber,
      date_decision: decision.decision_date,
      summary: summaryText,
      themes: decision.themes || [],
      source_url: `https://www.courdecassation.fr/decision/${decision.id}`,
      embedding: embedding,
    });

    if (insertError) {
      console.error(`Insert error for ${decision.number}:`, insertError.message);
      return 'error';
    }

    return 'inserted';
  } catch (error) {
    console.error(`Error processing ${decision.number}:`, error);
    return 'error';
  }
}

// ============================================================================
// IMPORT FUNCTIONS
// ============================================================================

async function importByFilter(
  supabase: any,
  filter: {
    publication?: string[];
    chamber?: string;
    date_start?: string;
    date_end?: string;
  },
  label: string,
  startPage: number = 0,
  maxPages: number = MAX_PAGES_PER_FILTER
): Promise<{ stats: ImportStats; lastPage: number; completed: boolean }> {
  const stats: ImportStats = { total: 0, inserted: 0, skipped: 0, errors: 0 };
  let page = startPage;
  let hasMore = true;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Starting import: ${label}`);
  console.log(`Filter: ${JSON.stringify(filter)}`);
  console.log(`Starting from page: ${page}`);
  console.log(`${'─'.repeat(60)}\n`);

  while (hasMore && page < startPage + maxPages) {
    try {
      await sleep(RATE_LIMIT_DELAY);
      const response = await fetchDecisions({ ...filter, page, page_size: PAGE_SIZE });
      const decisions = response.results;

      if (!decisions || decisions.length === 0) {
        hasMore = false;
        break;
      }

      stats.total += decisions.length;

      for (const decision of decisions) {
        const result = await insertDecision(supabase, decision);
        if (result === 'inserted') {
          stats.inserted++;
          process.stdout.write('.');
        } else if (result === 'skipped') {
          stats.skipped++;
          process.stdout.write('s');
        } else {
          stats.errors++;
          process.stdout.write('x');
        }
      }

      // Progress every 5 pages
      if ((page + 1) % 5 === 0) {
        console.log(`\n  [${label}] Page ${page + 1} | Total: ${stats.total} | Inserted: ${stats.inserted} | Skipped: ${stats.skipped}`);
      }

      // Check if more pages
      if (response.next_page === null || decisions.length < PAGE_SIZE) {
        hasMore = false;
      }

      page++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Handle rate limiting
      if (msg.includes('429')) {
        console.log('\n   Rate limited, waiting 10s...');
        await sleep(10000);
        continue; // Retry same page
      }

      console.error(`\n   Error on page ${page}: ${msg}`);
      stats.errors++;

      // Continue to next page on other errors
      page++;
    }
  }

  console.log(`\n\n${label} completed:`);
  console.log(`  Total processed: ${stats.total}`);
  console.log(`  Inserted: ${stats.inserted}`);
  console.log(`  Skipped: ${stats.skipped}`);
  console.log(`  Errors: ${stats.errors}`);

  return { stats, lastPage: page, completed: !hasMore };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n');
  console.log('='.repeat(65));
  console.log('     IMPORT MASSIF JUDILIBRE - JURISPRUDENCE');
  console.log('='.repeat(65));
  console.log('\n');

  // Parse args
  const args = process.argv.slice(2);
  const shouldResume = args.includes('--resume');
  const chamberIndex = args.indexOf('--chamber');
  const specificChamber = chamberIndex !== -1 ? args[chamberIndex + 1] : null;
  const limitIndex = args.indexOf('--limit');
  const pageLimit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : MAX_PAGES_PER_FILTER;
  const bulletinOnly = args.includes('--bulletin-only');

  // Validate environment
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE credentials');
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error('Missing MISTRAL_API_KEY');
    process.exit(1);
  }

  if (!process.env.PISTE_API_KEY) {
    console.error('Missing PISTE_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load or initialize progress
  let progress = shouldResume ? loadProgress() : {
    bulletin: { page: 0, completed: false },
    chambers: {},
    totalImported: 0,
    lastRun: new Date().toISOString(),
  };

  console.log(`Mode: ${shouldResume ? 'RESUME' : 'FRESH START'}`);
  if (specificChamber) console.log(`Chamber filter: ${specificChamber}`);
  if (pageLimit !== MAX_PAGES_PER_FILTER) console.log(`Page limit: ${pageLimit}`);
  console.log(`Progress file: ${PROGRESS_FILE}`);
  console.log('\n');

  const startTime = Date.now();
  let totalStats: ImportStats = { total: 0, inserted: 0, skipped: 0, errors: 0 };

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Import Bulletin decisions (highest priority)
  // ─────────────────────────────────────────────────────────────────────────

  if (!progress.bulletin.completed && !specificChamber) {
    console.log('\n📚 ÉTAPE 1: Arrêts publiés au Bulletin (priorité maximale)');

    const { stats, lastPage, completed } = await importByFilter(
      supabase,
      { publication: ['b'] },
      'Bulletin',
      progress.bulletin.page,
      pageLimit
    );

    totalStats.total += stats.total;
    totalStats.inserted += stats.inserted;
    totalStats.skipped += stats.skipped;
    totalStats.errors += stats.errors;

    progress.bulletin = { page: lastPage, completed };
    progress.totalImported += stats.inserted;
    saveProgress(progress);

    if (bulletinOnly) {
      console.log('\n--bulletin-only flag set, stopping here.');
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Import by chamber (recent decisions)
  // ─────────────────────────────────────────────────────────────────────────

  if (!bulletinOnly) {
    console.log('\n\n⚖️ ÉTAPE 2: Import par chambre (arrêts récents)');

    const chambersToImport = specificChamber
      ? CHAMBERS.filter(c => c.id === specificChamber)
      : CHAMBERS;

    for (const chamber of chambersToImport) {
      const chamberProgress = progress.chambers[chamber.id] || { page: 0, completed: false };

      if (chamberProgress.completed) {
        console.log(`\n   ${chamber.name}: déjà complété, skip`);
        continue;
      }

      console.log(`\n   Chambre: ${chamber.name} (${chamber.id})`);

      const { stats, lastPage, completed } = await importByFilter(
        supabase,
        {
          chamber: chamber.id,
          date_start: '2020-01-01',
          publication: ['b', 'r'],
        },
        chamber.name,
        chamberProgress.page,
        pageLimit
      );

      totalStats.total += stats.total;
      totalStats.inserted += stats.inserted;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;

      progress.chambers[chamber.id] = { page: lastPage, completed };
      progress.totalImported += stats.inserted;
      saveProgress(progress);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FINAL REPORT
  // ─────────────────────────────────────────────────────────────────────────

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n\n');
  console.log('='.repeat(65));
  console.log('                      RÉSUMÉ FINAL');
  console.log('='.repeat(65));
  console.log('\n');
  console.log(`   Total traité:     ${totalStats.total}`);
  console.log(`   Insérés:          ${totalStats.inserted}`);
  console.log(`   Ignorés (exist.): ${totalStats.skipped}`);
  console.log(`   Erreurs:          ${totalStats.errors}`);
  console.log(`   Durée:            ${duration} minutes`);
  console.log(`   Total cumulé:     ${progress.totalImported} arrêts`);
  console.log('\n');
  console.log('='.repeat(65));
  console.log('\n');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
