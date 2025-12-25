-- Script pour ajouter une contrainte UNIQUE sur la table court_decisions
-- Cela permet d'éviter les doublons lors des imports multiples
--
-- Comment l'exécuter :
-- 1. Va sur Supabase Dashboard → SQL Editor
-- 2. Copie-colle ce script
-- 3. Clique "Run"

-- Supprimer la contrainte si elle existe déjà (pour pouvoir relancer le script)
ALTER TABLE court_decisions
DROP CONSTRAINT IF EXISTS court_decisions_ecli_unique;

-- Ajouter la contrainte UNIQUE sur ecli
-- Note : Cela ignorera les valeurs NULL (plusieurs lignes peuvent avoir ecli = NULL)
CREATE UNIQUE INDEX IF NOT EXISTS court_decisions_ecli_unique
ON court_decisions(ecli)
WHERE ecli IS NOT NULL;

-- Index supplémentaire pour améliorer les performances de recherche
CREATE INDEX IF NOT EXISTS idx_court_decisions_case_number
ON court_decisions(case_number);

CREATE INDEX IF NOT EXISTS idx_court_decisions_jurisdiction
ON court_decisions(jurisdiction);

CREATE INDEX IF NOT EXISTS idx_court_decisions_date
ON court_decisions(date_decision DESC);

-- Vérification : Afficher les index créés
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'court_decisions'
ORDER BY indexname;

-- Message de confirmation
DO $$
BEGIN
    RAISE NOTICE 'Contrainte UNIQUE ajoutée avec succès sur ecli';
    RAISE NOTICE 'Index créés pour améliorer les performances';
END $$;
