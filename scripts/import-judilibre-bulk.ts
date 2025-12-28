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

// Legal keywords for search queries (API requires query parameter)
const LEGAL_QUERIES = [
  // Civil law
  { query: 'responsabilité civile', domain: 'civil', priority: 1 },
  { query: 'contrat', domain: 'civil', priority: 1 },
  { query: 'préjudice', domain: 'civil', priority: 1 },
  { query: 'obligation', domain: 'civil', priority: 2 },
  { query: 'nullité', domain: 'civil', priority: 2 },
  { query: 'résolution', domain: 'civil', priority: 2 },
  { query: 'dol', domain: 'civil', priority: 2 },
  { query: 'vice caché', domain: 'civil', priority: 2 },
  // Property law
  { query: 'propriété', domain: 'biens', priority: 2 },
  { query: 'servitude', domain: 'biens', priority: 3 },
  // Family law
  { query: 'divorce', domain: 'famille', priority: 2 },
  { query: 'succession', domain: 'famille', priority: 2 },
  // Labor law
  { query: 'licenciement', domain: 'travail', priority: 1 },
  { query: 'contrat de travail', domain: 'travail', priority: 1 },
  { query: 'faute grave', domain: 'travail', priority: 2 },
  // Commercial law
  { query: 'société', domain: 'commercial', priority: 1 },
  { query: 'abus de biens sociaux', domain: 'commercial', priority: 2 },
  { query: 'faillite', domain: 'commercial', priority: 2 },
  // Criminal law
  { query: 'abus de confiance', domain: 'pénal', priority: 1 },
  { query: 'escroquerie', domain: 'pénal', priority: 2 },
  { query: 'homicide', domain: 'pénal', priority: 2 },
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
  query?: string;
  type?: string;
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
  if (params.query) {
    queryParts.push(`query=${encodeURIComponent(params.query)}`);
  }
  if (params.type) {
    queryParts.push(`type=${encodeURIComponent(params.type)}`);
  }

  const url = `${JUDILIBRE_BASE}/search?${queryParts.join('&')}`;

  console.log('[API] URL:', url);

  const response = await fetch(url, {
    headers: {
      'KeyId': apiKey,
      'Accept': 'application/json',
    },
  });

  console.log('[API] Response status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.error('[API] Error response:', error.substring(0, 500));
    throw new Error(`Judilibre API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Debug logging
  console.log('[API] Response keys:', Object.keys(data));
  console.log('[API] Total:', data.total);
  console.log('[API] Results count:', data.results?.length ?? 'undefined');
  console.log('[API] Next page:', data.next_page);

  if (!data.results) {
    console.log('[API] Full response (no results):', JSON.stringify(data).substring(0, 1000));
  } else if (data.results.length > 0) {
    console.log('[API] First result keys:', Object.keys(data.results[0]));
    console.log('[API] First result sample:', JSON.stringify(data.results[0]).substring(0, 300));
  }

  return data;
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
    query?: string;
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
  const testMode = args.includes('--test');

  // Test mode: just fetch a few results without any filter to verify API works
  if (testMode) {
    console.log('\n🧪 TEST MODE: Fetching results without filters...\n');

    const apiKey = process.env.PISTE_API_KEY;
    if (!apiKey) {
      console.error('Missing PISTE_API_KEY');
      process.exit(1);
    }

    // Test 1: No filter at all
    console.log('--- Test 1: No filter ---');
    const test1 = await fetchDecisions({ page: 0, page_size: 5 });
    console.log(`Results: ${test1.results?.length || 0}\n`);

    // Test 2: Just date filter
    console.log('--- Test 2: Date filter (2024) ---');
    const test2 = await fetchDecisions({ page: 0, page_size: 5, date_start: '2024-01-01' });
    console.log(`Results: ${test2.results?.length || 0}\n`);

    // Test 3: Chamber filter
    console.log('--- Test 3: Chamber filter (civ1) ---');
    const test3 = await fetchDecisions({ page: 0, page_size: 5, chamber: 'civ1' });
    console.log(`Results: ${test3.results?.length || 0}\n`);

    // Test 4: Publication filter
    console.log('--- Test 4: Publication filter (b) ---');
    const test4 = await fetchDecisions({ page: 0, page_size: 5, publication: ['b'] });
    console.log(`Results: ${test4.results?.length || 0}\n`);

    // Test 5: With query parameter (text search)
    console.log('--- Test 5: Query "responsabilité" ---');
    const test5 = await fetchDecisions({ page: 0, page_size: 5, query: 'responsabilité' });
    console.log(`Results: ${test5.results?.length || 0}\n`);

    // Test 6: With query and type=arret
    console.log('--- Test 6: Query + type=arret ---');
    const test6 = await fetchDecisions({ page: 0, page_size: 5, query: 'contrat', type: 'arret' });
    console.log(`Results: ${test6.results?.length || 0}\n`);

    // Test 7: Export endpoint instead of search
    console.log('--- Test 7: Export endpoint ---');
    const exportUrl = `${JUDILIBRE_BASE}/export?batch_size=5`;
    console.log('[API] URL:', exportUrl);
    const exportResponse = await fetch(exportUrl, {
      headers: { 'KeyId': apiKey, 'Accept': 'application/json' }
    });
    console.log('[API] Response status:', exportResponse.status);
    if (exportResponse.ok) {
      const exportData = await exportResponse.json();
      console.log('[API] Export keys:', Object.keys(exportData));
      console.log('[API] Export sample:', JSON.stringify(exportData).substring(0, 500));
    } else {
      console.log('[API] Export error:', await exportResponse.text());
    }

    console.log('\nTest complete.');
    return;
  }

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
  // IMPORT BY LEGAL QUERIES (API requires query parameter)
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n📚 Import par requêtes juridiques');
  console.log(`   ${LEGAL_QUERIES.length} requêtes configurées`);
  console.log(`   Max ${pageLimit} pages par requête\n`);

  // Sort queries by priority
  const sortedQueries = [...LEGAL_QUERIES].sort((a, b) => a.priority - b.priority);

  for (const queryConfig of sortedQueries) {
    const queryKey = queryConfig.query.replace(/\s+/g, '_');
    const queryProgress = progress.chambers[queryKey] || { page: 0, completed: false };

    if (queryProgress.completed) {
      console.log(`   "${queryConfig.query}": déjà complété, skip`);
      continue;
    }

    console.log(`\n🔍 Recherche: "${queryConfig.query}" (${queryConfig.domain})`);

    const { stats, lastPage, completed } = await importByFilter(
      supabase,
      {
        query: queryConfig.query,
        publication: ['b'], // Only Bulletin for quality
      },
      queryConfig.query,
      queryProgress.page,
      pageLimit
    );

    totalStats.total += stats.total;
    totalStats.inserted += stats.inserted;
    totalStats.skipped += stats.skipped;
    totalStats.errors += stats.errors;

    progress.chambers[queryKey] = { page: lastPage, completed };
    progress.totalImported += stats.inserted;
    saveProgress(progress);

    // Early exit if bulletinOnly
    if (bulletinOnly && totalStats.inserted >= 100) {
      console.log('\n--bulletin-only flag set and 100+ imported, stopping.');
      break;
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
