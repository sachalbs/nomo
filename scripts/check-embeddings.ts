// @ts-nocheck
/**
 * Diagnostic script for embeddings
 *
 * Checks the state of embeddings in the database to diagnose vector search issues.
 *
 * Usage: npm run check-embeddings
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkEmbeddings() {
  console.log('\n');
  console.log('='.repeat(60));
  console.log('     DIAGNOSTIC EMBEDDINGS');
  console.log('='.repeat(60));
  console.log('\n');

  // Validate environment
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE credentials');
    process.exit(1);
  }

  try {
    // 1. Total articles
    const { data: totalData, error: totalError } = await supabase
      .from('law_articles')
      .select('*', { count: 'exact', head: true });

    if (totalError) {
      console.error('❌ Error counting total articles:', totalError);
      process.exit(1);
    }

    const total = totalData ? (totalData as any).count : 0;

    // 2. Articles with embedding
    const { data: withEmbeddingData, error: embeddingError } = await supabase
      .from('law_articles')
      .select('*', { count: 'exact', head: true })
      .not('embedding', 'is', null);

    if (embeddingError) {
      console.error('❌ Error counting articles with embeddings:', embeddingError);
      process.exit(1);
    }

    const withEmbedding = withEmbeddingData ? (withEmbeddingData as any).count : 0;

    // 3. Dimension of embedding vector
    const { data: dimensionData, error: dimensionError } = await supabase
      .from('law_articles')
      .select('embedding')
      .not('embedding', 'is', null)
      .limit(1);

    if (dimensionError) {
      console.error('❌ Error getting embedding dimension:', dimensionError);
      process.exit(1);
    }

    const dimension = dimensionData && dimensionData.length > 0 && dimensionData[0].embedding
      ? dimensionData[0].embedding.length
      : 0;

    // Display summary
    console.log('=== DIAGNOSTIC EMBEDDINGS ===');
    console.log('Total articles:', total);
    console.log('Avec embedding:', withEmbedding);
    console.log('Pourcentage:', (withEmbedding / total * 100).toFixed(1) + '%');
    console.log('Dimension vecteur:', dimension);
    console.log('\n');

    // Additional diagnostics
    if (withEmbedding === 0) {
      console.log('⚠️  PROBLÈME DÉTECTÉ: Aucun article n\'a d\'embedding!');
      console.log('   → Il faut générer les embeddings pour les articles.');
      console.log('\n');
    } else if (withEmbedding < total) {
      console.log(`⚠️  ATTENTION: ${total - withEmbedding} articles sans embedding`);
      console.log('   → Certains articles n\'ont pas d\'embedding.');
      console.log('\n');
    } else {
      console.log('✅ Tous les articles ont un embedding!');
      console.log('\n');
    }

    if (dimension === 0) {
      console.log('❌ ERREUR: Dimension du vecteur = 0');
      console.log('   → Les embeddings ne sont pas stockés correctement.');
      console.log('\n');
    } else if (dimension !== 1024) {
      console.log(`⚠️  ATTENTION: Dimension = ${dimension} (attendu: 1024 pour mistral-embed)`);
      console.log('   → Vérifier que le bon modèle d\'embedding est utilisé.');
      console.log('\n');
    } else {
      console.log('✅ Dimension correcte (1024 pour mistral-embed)');
      console.log('\n');
    }

    // Sample some articles
    console.log('=== ÉCHANTILLON D\'ARTICLES ===');
    const { data: sampleData, error: sampleError } = await supabase
      .from('law_articles')
      .select('id, code_name, article_number, embedding')
      .limit(5);

    if (sampleError) {
      console.error('❌ Error getting sample articles:', sampleError);
    } else if (sampleData) {
      sampleData.forEach((article, index) => {
        const hasEmb = article.embedding !== null && article.embedding !== undefined;
        const embLength = hasEmb && Array.isArray(article.embedding) ? article.embedding.length : 0;
        const status = hasEmb ? '✅' : '❌';
        console.log(`${status} ${article.code_name} - ${article.article_number} (embedding: ${embLength})`);
      });
      console.log('\n');
    }

    console.log('='.repeat(60));
    console.log('\n');
  } catch (error) {
    console.error('❌ Erreur lors du diagnostic:', error);
    process.exit(1);
  }
}

checkEmbeddings().catch((error) => {
  console.error('Diagnostic failed:', error);
  process.exit(1);
});
