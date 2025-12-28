// @ts-nocheck
/**
 * RAG Evaluation Script for Nomo
 *
 * Tests the RAG system against a predefined dataset of legal questions.
 * Measures recall (% of expected articles found) per domain and globally.
 *
 * Usage: npm run evaluate
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { fullRagSearch, analyzeQuestion } from '../lib/rag-pipeline';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface EvalQuestion {
  id: string;
  question: string;
  domain: string;
  difficulty: string;
  expectedArticles: string[];
  expectedCodes: string[];
  keywords: string[];
}

interface EvalResult {
  id: string;
  question: string;
  domain: string;
  difficulty: string;
  expectedArticles: string[];
  foundArticles: string[];
  recall: number;
  missing: string[];
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.mistral.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-embed',
      input: [text],
    }),
  });

  if (!response.ok) {
    throw new Error(`Mistral API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function searchArticles(query: string, embedding: number[], analysis?: any): Promise<string[]> {
  const results = await fullRagSearch(supabase, query, embedding, 10, analysis);
  return results.map(a => a.article_number.replace(/^Article\s*/i, ''));
}

function calculateRecall(expected: string[], found: string[]): { recall: number; missing: string[] } {
  const matched = expected.filter(e => {
    const normalizedExpected = e.toLowerCase().replace(/\s+/g, '');
    return found.some(f => {
      const normalizedFound = f.toLowerCase().replace(/\s+/g, '');
      return normalizedFound.includes(normalizedExpected) ||
             normalizedExpected.includes(normalizedFound);
    });
  });

  const missing = expected.filter(e => !matched.includes(e));
  return {
    recall: expected.length > 0 ? matched.length / expected.length : 1,
    missing
  };
}

async function evaluate() {
  console.log('\n');
  console.log('='.repeat(60));
  console.log('     EVALUATION DU RAG NOMO');
  console.log('='.repeat(60));
  console.log('\n');

  // Validate environment
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE credentials');
    process.exit(1);
  }

  if (!process.env.MISTRAL_API_KEY) {
    console.error('Missing MISTRAL_API_KEY');
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  // Load dataset
  const datasetPath = 'data/evaluation-dataset.json';
  if (!fs.existsSync(datasetPath)) {
    console.error(`Dataset not found: ${datasetPath}`);
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  const questions: EvalQuestion[] = dataset.questions;

  console.log(`Loaded ${questions.length} questions\n`);
  console.log('-'.repeat(60));

  const results: EvalResult[] = [];
  const startTime = Date.now();

  for (const q of questions) {
    process.stdout.write(`[${q.id.padStart(2)}] ${q.question.substring(0, 45).padEnd(45)}...`);

    try {
      const analysis = await analyzeQuestion(q.question, process.env.ANTHROPIC_API_KEY!);
      const embedding = await generateEmbedding(q.question);
      const foundArticles = await searchArticles(q.question, embedding, analysis);
      const { recall, missing } = calculateRecall(q.expectedArticles, foundArticles);

      results.push({
        id: q.id,
        question: q.question,
        domain: q.domain,
        difficulty: q.difficulty,
        expectedArticles: q.expectedArticles,
        foundArticles,
        recall,
        missing
      });

      const emoji = recall === 1 ? ' ✅' : recall >= 0.5 ? ' ⚠️' : ' ❌';
      console.log(`${emoji} ${(recall * 100).toFixed(0).padStart(3)}%`);

      if (missing.length > 0 && recall < 1) {
        console.log(`     Missing: ${missing.join(', ')}`);
        console.log(`     Found: ${foundArticles.slice(0, 5).join(', ')}`);
      }
    } catch (error) {
      console.log(` ❌ Error: ${error}`);
      results.push({
        id: q.id,
        question: q.question,
        domain: q.domain,
        difficulty: q.difficulty,
        expectedArticles: q.expectedArticles,
        foundArticles: [],
        recall: 0,
        missing: q.expectedArticles
      });
    }

    // Rate limiting for Mistral API
    await new Promise(r => setTimeout(r, 500));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Final Report
  console.log('\n');
  console.log('='.repeat(60));
  console.log('     RAPPORT FINAL');
  console.log('='.repeat(60));
  console.log('\n');

  // By domain
  console.log('RECALL PAR DOMAINE :');
  console.log('-'.repeat(30));
  const domains = [...new Set(results.map(r => r.domain))];
  for (const domain of domains.sort()) {
    const domainResults = results.filter(r => r.domain === domain);
    const avgRecall = domainResults.reduce((sum, r) => sum + r.recall, 0) / domainResults.length;
    const emoji = avgRecall >= 0.8 ? '✅' : avgRecall >= 0.5 ? '⚠️' : '❌';
    console.log(`  ${emoji} ${domain.padEnd(12)} : ${(avgRecall * 100).toFixed(0).padStart(3)}% (${domainResults.length} questions)`);
  }

  // By difficulty
  console.log('\nRECALL PAR DIFFICULTÉ :');
  console.log('-'.repeat(30));
  const difficulties = ['simple', 'medium', 'complex'];
  for (const diff of difficulties) {
    const diffResults = results.filter(r => r.difficulty === diff);
    if (diffResults.length > 0) {
      const avgRecall = diffResults.reduce((sum, r) => sum + r.recall, 0) / diffResults.length;
      const emoji = avgRecall >= 0.8 ? '✅' : avgRecall >= 0.5 ? '⚠️' : '❌';
      console.log(`  ${emoji} ${diff.padEnd(12)} : ${(avgRecall * 100).toFixed(0).padStart(3)}% (${diffResults.length} questions)`);
    }
  }

  // Global recall
  const globalRecall = results.reduce((sum, r) => sum + r.recall, 0) / results.length;
  const perfectRecall = results.filter(r => r.recall === 1).length;
  const zeroRecall = results.filter(r => r.recall === 0).length;

  console.log('\n' + '='.repeat(30));
  console.log(`  RECALL GLOBAL : ${(globalRecall * 100).toFixed(0)}%`);
  console.log('='.repeat(30));
  console.log(`  Perfect (100%) : ${perfectRecall}/${results.length}`);
  console.log(`  Failed (0%)    : ${zeroRecall}/${results.length}`);
  console.log(`  Duration       : ${duration}s`);

  // Problematic questions
  const problematic = results.filter(r => r.recall < 0.5);
  if (problematic.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('QUESTIONS PROBLÉMATIQUES (recall < 50%) :');
    console.log('-'.repeat(60));
    problematic.forEach(p => {
      console.log(`\n  [${p.id}] ${p.question}`);
      console.log(`      Domain: ${p.domain} | Difficulty: ${p.difficulty}`);
      console.log(`      Expected: ${p.expectedArticles.join(', ')}`);
      console.log(`      Found: ${p.foundArticles.slice(0, 5).join(', ') || 'none'}`);
      console.log(`      Missing: ${p.missing.join(', ')}`);
    });
  }

  // Summary
  console.log('\n');
  console.log('='.repeat(60));
  if (globalRecall >= 0.8) {
    console.log('  ✅ RAG Performance: EXCELLENT');
  } else if (globalRecall >= 0.6) {
    console.log('  ⚠️ RAG Performance: ACCEPTABLE');
  } else {
    console.log('  ❌ RAG Performance: NEEDS IMPROVEMENT');
  }
  console.log('='.repeat(60));
  console.log('\n');
}

evaluate().catch((error) => {
  console.error('Evaluation failed:', error);
  process.exit(1);
});
