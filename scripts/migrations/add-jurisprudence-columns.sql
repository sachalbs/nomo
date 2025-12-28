-- Migration: Add columns to court_decisions table for bulk Judilibre import
-- Run this in Supabase SQL Editor before running import:judilibre-bulk

-- Add new columns if they don't exist
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS ecli TEXT;
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS numero_pourvoi TEXT;
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS solution TEXT;
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS themes TEXT[];
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS importance TEXT DEFAULT 'courant';
ALTER TABLE court_decisions ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'judilibre';

-- Add unique constraint on case_number to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'court_decisions_case_number_unique'
  ) THEN
    ALTER TABLE court_decisions ADD CONSTRAINT court_decisions_case_number_unique UNIQUE (case_number);
  END IF;
END $$;

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_court_decisions_chambre ON court_decisions(chambre);
CREATE INDEX IF NOT EXISTS idx_court_decisions_importance ON court_decisions(importance);
CREATE INDEX IF NOT EXISTS idx_court_decisions_date ON court_decisions(date_decision);
CREATE INDEX IF NOT EXISTS idx_court_decisions_jurisdiction ON court_decisions(jurisdiction);

-- Create GIN index for themes array (for full-text search on themes)
CREATE INDEX IF NOT EXISTS idx_court_decisions_themes ON court_decisions USING GIN(themes);

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'court_decisions'
ORDER BY ordinal_position;
