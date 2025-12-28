import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
  console.log('🔍 Investigation de la structure court_decisions\n');

  // 1. Get a sample record to see the schema
  console.log('📋 Échantillon (1 arrêt):');
  const { data: sample } = await supabase
    .from('court_decisions')
    .select('*')
    .limit(1);

  if (sample && sample.length > 0) {
    console.log('Colonnes disponibles:', Object.keys(sample[0]));
    console.log('\nPremier arrêt:');
    console.log(JSON.stringify(sample[0], null, 2));
  }

  // 2. Check if 'content' field exists and has data
  console.log('\n📊 Vérification champ "content":');
  const { data: withContent } = await supabase
    .from('court_decisions')
    .select('id, content')
    .not('content', 'is', null)
    .limit(5);

  if (withContent) {
    console.log(`Arrêts avec content non-null: ${withContent.length}/5`);
    if (withContent.length > 0) {
      console.log('\nExemple content:');
      console.log(withContent[0].content?.substring(0, 300));
    }
  }

  // 3. Check if 'summary' field exists
  console.log('\n📊 Vérification champ "summary":');
  const { data: withSummary } = await supabase
    .from('court_decisions')
    .select('id, summary')
    .not('summary', 'is', null)
    .limit(5);

  if (withSummary) {
    console.log(`Arrêts avec summary non-null: ${withSummary.length}/5`);
    if (withSummary.length > 0) {
      console.log('\nExemple summary:');
      console.log(withSummary[0].summary?.substring(0, 300));
    }
  }

  // 4. Check title field (seems to be JSON)
  console.log('\n📊 Vérification champ "title":');
  const { data: withTitle } = await supabase
    .from('court_decisions')
    .select('id, title')
    .not('title', 'is', null)
    .limit(3);

  if (withTitle) {
    console.log(`Arrêts avec title non-null: ${withTitle.length}/3`);
    if (withTitle.length > 0) {
      console.log('\nExemple title (structure):');
      console.log(typeof withTitle[0].title);
      console.log(JSON.stringify(withTitle[0].title, null, 2));
    }
  }

  // 5. Search in summary field instead of content
  console.log('\n🔍 Recherche thématique dans "summary":');

  const themes = [
    { name: 'Formation contrat', pattern: '%formation%' },
    { name: 'Responsabilité', pattern: '%responsabilité%' },
    { name: 'Force majeure', pattern: '%force majeure%' },
    { name: 'Inexécution', pattern: '%inexécution%' },
  ];

  for (const theme of themes) {
    const { count } = await supabase
      .from('court_decisions')
      .select('*', { count: 'exact', head: true })
      .ilike('summary', theme.pattern);

    console.log(`  ${theme.name}: ${count} arrêts`);
  }

  // 6. Search in title->titles array
  console.log('\n🔍 Recherche thématique dans "title":');

  const { data: allDecisions } = await supabase
    .from('court_decisions')
    .select('title')
    .not('title', 'is', null)
    .limit(1000);

  if (allDecisions) {
    let formationCount = 0;
    let responsabiliteCount = 0;
    let forceMajeureCount = 0;

    for (const d of allDecisions) {
      const titleStr = JSON.stringify(d.title).toLowerCase();
      if (titleStr.includes('formation') || titleStr.includes('contrat')) formationCount++;
      if (titleStr.includes('responsabilité') || titleStr.includes('responsabilite')) responsabiliteCount++;
      if (titleStr.includes('force majeure')) forceMajeureCount++;
    }

    console.log(`  Formation/Contrat: ${formationCount} arrêts (sur 1000 échantillonnés)`);
    console.log(`  Responsabilité: ${responsabiliteCount} arrêts`);
    console.log(`  Force majeure: ${forceMajeureCount} arrêts`);
  }

  console.log('\n✅ Investigation terminée');
}

investigate().catch(console.error);
