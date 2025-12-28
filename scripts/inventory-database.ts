import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface InventoryReport {
  jurisprudence: {
    total: number;
    byJurisdiction: { jurisdiction: string; count: number }[];
    byChambre: { chambre: string; count: number }[];
    byYear: { year: number; count: number }[];
    thematique: {
      formation: number;
      responsabilite: number;
      forceMajeure: number;
      inexecution: number;
      clausePenale: number;
      delaiGrace: number;
      vice: number;
    };
    sample: any[];
  };
  articles: {
    total: number;
    byCode: { code_name: string; count: number }[];
    criticalSections: {
      formation_1112_1127: string[];
      responsabilite_1240_1244: string[];
      inexecution_1217_1231: string[];
      paiement_1342_1352: string[];
    };
    article1112: { present: boolean; content?: string };
  };
}

async function runInventory(): Promise<InventoryReport> {
  const report: InventoryReport = {
    jurisprudence: {
      total: 0,
      byJurisdiction: [],
      byChambre: [],
      byYear: [],
      thematique: {
        formation: 0,
        responsabilite: 0,
        forceMajeure: 0,
        inexecution: 0,
        clausePenale: 0,
        delaiGrace: 0,
        vice: 0,
      },
      sample: [],
    },
    articles: {
      total: 0,
      byCode: [],
      criticalSections: {
        formation_1112_1127: [],
        responsabilite_1240_1244: [],
        inexecution_1217_1231: [],
        paiement_1342_1352: [],
      },
      article1112: { present: false },
    },
  };

  console.log('🔍 Inventaire de la base de données Nomo\n');

  // ===== JURISPRUDENCE =====
  console.log('📚 Analyse de la jurisprudence...');

  // Total court decisions
  const { count: totalJurisp, error: totalError } = await supabase
    .from('court_decisions')
    .select('*', { count: 'exact', head: true });

  if (totalError) {
    console.error('❌ Erreur total jurisprudence:', totalError);
  } else {
    report.jurisprudence.total = totalJurisp || 0;
    console.log(`✅ Total arrêts: ${totalJurisp}`);
  }

  // By jurisdiction
  const { data: byJurisp, error: jurispError } = await supabase
    .from('court_decisions')
    .select('jurisdiction')
    .not('jurisdiction', 'is', null);

  if (!jurispError && byJurisp) {
    const counts = byJurisp.reduce((acc: any, row: any) => {
      acc[row.jurisdiction] = (acc[row.jurisdiction] || 0) + 1;
      return acc;
    }, {});
    report.jurisprudence.byJurisdiction = Object.entries(counts)
      .map(([jurisdiction, count]) => ({ jurisdiction, count: count as number }))
      .sort((a, b) => b.count - a.count);
    console.log(`✅ Juridictions: ${Object.keys(counts).length}`);
  }

  // By chambre
  const { data: byChambre, error: chambreError } = await supabase
    .from('court_decisions')
    .select('chambre')
    .not('chambre', 'is', null);

  if (!chambreError && byChambre) {
    const counts = byChambre.reduce((acc: any, row: any) => {
      acc[row.chambre] = (acc[row.chambre] || 0) + 1;
      return acc;
    }, {});
    report.jurisprudence.byChambre = Object.entries(counts)
      .map(([chambre, count]) => ({ chambre, count: count as number }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // Top 20
    console.log(`✅ Chambres: ${Object.keys(counts).length}`);
  }

  // By year
  const { data: allDecisions, error: decisionsError } = await supabase
    .from('court_decisions')
    .select('date_decision')
    .not('date_decision', 'is', null);

  if (!decisionsError && allDecisions) {
    const years = allDecisions.map((d: any) => new Date(d.date_decision).getFullYear());
    const counts = years.reduce((acc: any, year: number) => {
      acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {});
    report.jurisprudence.byYear = Object.entries(counts)
      .map(([year, count]) => ({ year: Number(year), count: count as number }))
      .sort((a, b) => b.year - a.year);
    console.log(`✅ Années: ${Math.min(...years)} - ${Math.max(...years)}`);
  }

  // Thematic coverage
  console.log('📊 Analyse thématique...');

  const themes = [
    { key: 'formation', patterns: ['%formation%', '%pourparlers%', '%1112%', '%offre%acceptation%'] },
    { key: 'responsabilite', patterns: ['%responsabilité%', '%1240%', '%1382%'] },
    { key: 'forceMajeure', patterns: ['%force majeure%', '%1218%'] },
    { key: 'inexecution', patterns: ['%inexécution%', '%résolution%', '%1224%'] },
    { key: 'clausePenale', patterns: ['%clause pénale%', '%1231-5%'] },
    { key: 'delaiGrace', patterns: ['%délai de grâce%', '%1343-5%'] },
    { key: 'vice', patterns: ['%erreur%', '%dol%', '%violence%'] },
  ];

  for (const theme of themes) {
    const seen = new Set<string>();
    for (const pattern of theme.patterns) {
      const { data } = await supabase
        .from('court_decisions')
        .select('id')
        .ilike('summary', pattern);
      if (data) {
        data.forEach((d: any) => seen.add(d.id));
      }
    }
    (report.jurisprudence.thematique as any)[theme.key] = seen.size;
    console.log(`  - ${theme.key}: ${seen.size} arrêts`);
  }

  // Sample (20 recent)
  const { data: sample } = await supabase
    .from('court_decisions')
    .select('case_number, chambre, date_decision, title')
    .order('date_decision', { ascending: false })
    .limit(20);

  if (sample) {
    report.jurisprudence.sample = sample;
    console.log(`✅ Échantillon: ${sample.length} arrêts récents`);
  }

  // ===== ARTICLES DE LOI =====
  console.log('\n📖 Analyse des articles de loi...');

  // Total articles
  const { count: totalArticles, error: articlesError } = await supabase
    .from('law_articles')
    .select('*', { count: 'exact', head: true });

  if (articlesError) {
    console.error('❌ Erreur total articles:', articlesError);
  } else {
    report.articles.total = totalArticles || 0;
    console.log(`✅ Total articles: ${totalArticles}`);
  }

  // By code
  const { data: byCode, error: codeError } = await supabase
    .from('law_articles')
    .select('code_name');

  if (!codeError && byCode) {
    const counts = byCode.reduce((acc: any, row: any) => {
      acc[row.code_name] = (acc[row.code_name] || 0) + 1;
      return acc;
    }, {});
    report.articles.byCode = Object.entries(counts)
      .map(([code_name, count]) => ({ code_name, count: count as number }))
      .sort((a, b) => b.count - a.count);
    console.log(`✅ Codes: ${Object.keys(counts).length}`);
  }

  // Critical sections - Formation (1112-1127)
  console.log('📑 Vérification sections critiques Code civil...');

  const formationNumbers = Array.from({ length: 16 }, (_, i) => 1112 + i);
  const { data: formation } = await supabase
    .from('law_articles')
    .select('article_number')
    .eq('code_name', 'Code civil')
    .or(formationNumbers.map(n => `article_number.ilike.%${n}%`).join(','));

  if (formation) {
    report.articles.criticalSections.formation_1112_1127 = formation.map((a: any) => a.article_number).sort();
    console.log(`  - Formation (1112-1127): ${formation.length}/16 articles`);
  }

  // Responsabilité (1240-1244)
  const { data: responsabilite } = await supabase
    .from('law_articles')
    .select('article_number')
    .eq('code_name', 'Code civil')
    .or('article_number.ilike.%1240%,article_number.ilike.%1241%,article_number.ilike.%1242%,article_number.ilike.%1243%,article_number.ilike.%1244%');

  if (responsabilite) {
    report.articles.criticalSections.responsabilite_1240_1244 = responsabilite.map((a: any) => a.article_number).sort();
    console.log(`  - Responsabilité (1240-1244): ${responsabilite.length}/5 articles`);
  }

  // Inexécution (1217-1231)
  const inexecNumbers = Array.from({ length: 15 }, (_, i) => 1217 + i);
  const { data: inexecution } = await supabase
    .from('law_articles')
    .select('article_number')
    .eq('code_name', 'Code civil')
    .or(inexecNumbers.map(n => `article_number.ilike.%${n}%`).join(','));

  if (inexecution) {
    report.articles.criticalSections.inexecution_1217_1231 = inexecution.map((a: any) => a.article_number).sort();
    console.log(`  - Inexécution (1217-1231): ${inexecution.length}/15 articles`);
  }

  // Paiement (1342-1352)
  const paiementNumbers = Array.from({ length: 11 }, (_, i) => 1342 + i);
  const { data: paiement } = await supabase
    .from('law_articles')
    .select('article_number')
    .eq('code_name', 'Code civil')
    .or(paiementNumbers.map(n => `article_number.ilike.%${n}%`).join(','));

  if (paiement) {
    report.articles.criticalSections.paiement_1342_1352 = paiement.map((a: any) => a.article_number).sort();
    console.log(`  - Paiement (1342-1352): ${paiement.length}/11 articles`);
  }

  // Article 1112 specifically
  const { data: article1112 } = await supabase
    .from('law_articles')
    .select('article_number, content')
    .ilike('article_number', '%1112%')
    .limit(1);

  if (article1112 && article1112.length > 0) {
    report.articles.article1112 = {
      present: true,
      content: article1112[0].content.substring(0, 500),
    };
    console.log('✅ Article 1112: PRÉSENT');
  } else {
    report.articles.article1112 = { present: false };
    console.log('❌ Article 1112: ABSENT');
  }

  return report;
}

async function generateMarkdownReport(report: InventoryReport) {
  const md: string[] = [];

  md.push('# INVENTAIRE DE LA BASE DE DONNÉES NOMO');
  md.push(`**Date**: ${new Date().toISOString().split('T')[0]}`);
  md.push('**Objectif**: Évaluer la complétude de la base pour les cas pratiques en droit des obligations\n');
  md.push('---\n');

  // RÉSUMÉ EXÉCUTIF
  md.push('## RÉSUMÉ EXÉCUTIF\n');

  const totalJurisp = report.jurisprudence.total;
  const totalArticles = report.articles.total;
  const nbCodes = report.articles.byCode.length;

  md.push('| Métrique | Valeur |');
  md.push('|----------|--------|');
  md.push(`| **Total jurisprudence** | ${totalJurisp} arrêts |`);
  md.push(`| **Total articles de loi** | ${totalArticles} articles |`);
  md.push(`| **Codes couverts** | ${nbCodes} codes |`);

  const topJurisp = report.jurisprudence.byJurisdiction[0];
  if (topJurisp) {
    md.push(`| **Principale juridiction** | ${topJurisp.jurisdiction} (${topJurisp.count} arrêts) |`);
  }

  const topCode = report.articles.byCode[0];
  if (topCode) {
    md.push(`| **Code principal** | ${topCode.code_name} (${topCode.count} articles) |`);
  }

  const years = report.jurisprudence.byYear;
  if (years.length > 0) {
    const minYear = Math.min(...years.map(y => y.year));
    const maxYear = Math.max(...years.map(y => y.year));
    md.push(`| **Plage dates jurisprudence** | ${minYear} - ${maxYear} |`);
  }

  md.push('\n### Principales lacunes\n');

  const lacunes: string[] = [];

  // Check critical sections
  const formation = report.articles.criticalSections.formation_1112_1127.length;
  if (formation < 12) lacunes.push(`❌ Formation du contrat: seulement ${formation}/16 articles`);

  if (!report.articles.article1112.present) {
    lacunes.push('🔴 **CRITIQUE**: Article 1112 (pourparlers) ABSENT');
  }

  if (report.jurisprudence.thematique.formation < 50) {
    lacunes.push(`⚠️ Jurisprudence formation contrat faible: ${report.jurisprudence.thematique.formation} arrêts`);
  }

  if (report.jurisprudence.thematique.delaiGrace < 10) {
    lacunes.push(`⚠️ Jurisprudence délai de grâce faible: ${report.jurisprudence.thematique.delaiGrace} arrêts`);
  }

  if (lacunes.length > 0) {
    md.push(...lacunes.map(l => `- ${l}`));
  } else {
    md.push('✅ Aucune lacune majeure détectée');
  }

  md.push('\n---\n');

  // JURISPRUDENCE
  md.push('## JURISPRUDENCE\n');
  md.push('### Statistiques globales\n');
  md.push('| Métrique | Valeur |');
  md.push('|----------|--------|');
  md.push(`| Total arrêts | ${report.jurisprudence.total} |`);

  const topJurisps = report.jurisprudence.byJurisdiction.slice(0, 5);
  topJurisps.forEach(j => {
    md.push(`| ${j.jurisdiction} | ${j.count} |`);
  });

  md.push('\n### Par chambre (Top 15)\n');
  md.push('| Chambre | Nb arrêts |');
  md.push('|---------|-----------|');

  const topChambres = report.jurisprudence.byChambre.slice(0, 15);
  topChambres.forEach(c => {
    md.push(`| ${c.chambre} | ${c.count} |`);
  });

  md.push('\n### Par année (10 dernières)\n');
  md.push('| Année | Nb arrêts |');
  md.push('|-------|-----------|');

  const topYears = report.jurisprudence.byYear.slice(0, 10);
  topYears.forEach(y => {
    md.push(`| ${y.year} | ${y.count} |`);
  });

  md.push('\n### Couverture thématique (droit des obligations)\n');
  md.push('| Thème | Nb arrêts | Suffisant ? |');
  md.push('|-------|-----------|-------------|');

  const themes = [
    { name: 'Formation contrat / Pourparlers', key: 'formation', threshold: 50 },
    { name: 'Responsabilité civile', key: 'responsabilite', threshold: 100 },
    { name: 'Force majeure', key: 'forceMajeure', threshold: 50 },
    { name: 'Inexécution / Résolution', key: 'inexecution', threshold: 80 },
    { name: 'Clause pénale', key: 'clausePenale', threshold: 30 },
    { name: 'Délai de grâce', key: 'delaiGrace', threshold: 20 },
    { name: 'Vices du consentement', key: 'vice', threshold: 60 },
  ];

  themes.forEach(t => {
    const count = (report.jurisprudence.thematique as any)[t.key];
    let status = '✅';
    if (count < t.threshold * 0.5) status = '❌';
    else if (count < t.threshold) status = '⚠️';
    md.push(`| ${t.name} | ${count} | ${status} |`);
  });

  md.push('\n### Échantillon (20 arrêts les plus récents)\n');
  md.push('| Numéro | Chambre | Date | Titre |');
  md.push('|--------|---------|------|-------|');

  report.jurisprudence.sample.forEach(s => {
    const title = (s.title || '').substring(0, 80);
    const date = new Date(s.date_decision).toISOString().split('T')[0];
    md.push(`| ${s.case_number} | ${s.chambre || 'N/A'} | ${date} | ${title} |`);
  });

  md.push('\n---\n');

  // ARTICLES DE LOI
  md.push('## ARTICLES DE LOI\n');
  md.push('### Par code\n');
  md.push('| Code | Nb articles |');
  md.push('|------|-------------|');

  report.articles.byCode.forEach(c => {
    md.push(`| ${c.code_name} | ${c.count} |`);
  });

  md.push('\n### Couverture Code civil - Droit des obligations\n');
  md.push('| Section | Articles attendus | Présents | Manquants |');
  md.push('|---------|-------------------|----------|-----------|');

  const sections = [
    { name: 'Formation (1112-1127)', expected: 16, present: report.articles.criticalSections.formation_1112_1127 },
    { name: 'Responsabilité (1240-1244)', expected: 5, present: report.articles.criticalSections.responsabilite_1240_1244 },
    { name: 'Inexécution (1217-1231)', expected: 15, present: report.articles.criticalSections.inexecution_1217_1231 },
    { name: 'Paiement (1342-1352)', expected: 11, present: report.articles.criticalSections.paiement_1342_1352 },
  ];

  sections.forEach(s => {
    const missing = s.expected - s.present.length;
    md.push(`| ${s.name} | ${s.expected} | ${s.present.length} | ${missing} |`);
  });

  md.push('\n### Article 1112 (Pourparlers) - Vérification spécifique\n');

  if (report.articles.article1112.present) {
    md.push('**Statut**: ✅ **PRÉSENT**\n');
    md.push('**Contenu**:');
    md.push('```');
    md.push(report.articles.article1112.content || '');
    md.push('```');
  } else {
    md.push('**Statut**: ❌ **ABSENT**\n');
    md.push('🔴 **CRITIQUE**: L\'article 1112 sur les pourparlers et la phase précontractuelle est manquant dans la base.');
    md.push('Cet article est essentiel pour les cas pratiques en droit des obligations.');
  }

  md.push('\n---\n');

  // LACUNES CRITIQUES
  md.push('## LACUNES CRITIQUES\n');
  md.push('### Jurisprudence\n');

  const jurispLacunes: string[] = [];

  themes.forEach(t => {
    const count = (report.jurisprudence.thematique as any)[t.key];
    if (count < t.threshold * 0.5) {
      jurispLacunes.push(`🔴 **${t.name}**: ${count} arrêts (objectif: ${t.threshold})`);
    } else if (count < t.threshold) {
      jurispLacunes.push(`⚠️ **${t.name}**: ${count} arrêts (objectif: ${t.threshold})`);
    }
  });

  if (jurispLacunes.length > 0) {
    md.push(...jurispLacunes.map(l => `- ${l}`));
  } else {
    md.push('✅ Couverture jurisprudentielle satisfaisante');
  }

  md.push('\n### Articles de loi\n');

  const articlesLacunes: string[] = [];

  sections.forEach(s => {
    const missing = s.expected - s.present.length;
    if (missing > s.expected * 0.3) {
      articlesLacunes.push(`🔴 **${s.name}**: ${missing} articles manquants (${s.present.length}/${s.expected})`);
    } else if (missing > 0) {
      articlesLacunes.push(`⚠️ **${s.name}**: ${missing} articles manquants (${s.present.length}/${s.expected})`);
    }
  });

  if (!report.articles.article1112.present) {
    articlesLacunes.unshift('🔴 **Article 1112 ABSENT** - Essentiel pour pourparlers/phase précontractuelle');
  }

  if (articlesLacunes.length > 0) {
    md.push(...articlesLacunes.map(l => `- ${l}`));
  } else {
    md.push('✅ Couverture articles satisfaisante');
  }

  md.push('\n---\n');

  // RECOMMANDATIONS
  md.push('## RECOMMANDATIONS\n');
  md.push('### Actions prioritaires\n');

  const recommendations: string[] = [];

  if (!report.articles.article1112.present) {
    recommendations.push({
      priority: '🔴 P0',
      action: 'Importer l\'article 1112 du Code civil',
      detail: 'Article essentiel pour les cas pratiques sur la formation du contrat',
    });
  }

  sections.forEach(s => {
    const coverage = (s.present.length / s.expected) * 100;
    if (coverage < 70) {
      recommendations.push({
        priority: '🔴 P1',
        action: `Compléter ${s.name}`,
        detail: `Seulement ${s.present.length}/${s.expected} articles présents (${coverage.toFixed(0)}%)`,
      });
    }
  });

  themes.forEach(t => {
    const count = (report.jurisprudence.thematique as any)[t.key];
    if (count < t.threshold * 0.5) {
      recommendations.push({
        priority: '🟠 P2',
        action: `Enrichir jurisprudence: ${t.name}`,
        detail: `Seulement ${count} arrêts (objectif: ${t.threshold})`,
      });
    }
  });

  if (recommendations.length > 0) {
    md.push('| Priorité | Action | Détail |');
    md.push('|----------|--------|--------|');
    recommendations.forEach((r: any) => {
      md.push(`| ${r.priority} | ${r.action} | ${r.detail} |`);
    });
  } else {
    md.push('✅ Aucune action prioritaire - Base satisfaisante');
  }

  md.push('\n### Optimisations suggérées\n');
  md.push('- 📊 Mettre en place un monitoring continu de la couverture thématique');
  md.push('- 🔄 Scraper régulièrement Légifrance pour les nouvelles décisions');
  md.push('- 📈 Viser 100+ arrêts par thème majeur pour robustesse du RAG');
  md.push('- 🎯 Prioriser les arrêts de principe (Ass. plén., Ch. mixte)');
  md.push('- 📝 Ajouter métadonnées: tags thématiques, mots-clés, résumés');

  md.push('\n---\n');
  md.push('**Fin de l\'inventaire**');

  return md.join('\n');
}

async function main() {
  try {
    console.log('🚀 Démarrage de l\'inventaire...\n');

    const report = await runInventory();

    console.log('\n✍️ Génération du rapport Markdown...');
    const markdown = await generateMarkdownReport(report);

    const outputPath = path.join(__dirname, '../INVENTAIRE_BDD_NOMO.md');
    fs.writeFileSync(outputPath, markdown, 'utf-8');

    console.log(`\n✅ Rapport généré: ${outputPath}`);

    // Also save JSON for programmatic use
    const jsonPath = path.join(__dirname, '../inventory-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`✅ Données JSON: ${jsonPath}`);

  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  }
}

main();
