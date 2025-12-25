-- Create court_decisions table for Judilibre data
-- Run this in Supabase SQL Editor before running the import script

CREATE TABLE IF NOT EXISTS court_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id TEXT UNIQUE NOT NULL,
  numero TEXT,
  juridiction TEXT NOT NULL,
  chambre TEXT,
  formation TEXT,
  date_decision DATE,
  solution TEXT,
  resume TEXT,
  sommaire TEXT,
  texte_integral TEXT,
  publication TEXT[],
  ecli TEXT,
  source_url TEXT,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_court_decisions_juridiction ON court_decisions(juridiction);
CREATE INDEX IF NOT EXISTS idx_court_decisions_chambre ON court_decisions(chambre);
CREATE INDEX IF NOT EXISTS idx_court_decisions_date ON court_decisions(date_decision DESC);
CREATE INDEX IF NOT EXISTS idx_court_decisions_decision_id ON court_decisions(decision_id);

-- Create vector similarity search index (using HNSW for better performance)
CREATE INDEX IF NOT EXISTS idx_court_decisions_embedding ON court_decisions
USING hnsw (embedding vector_cosine_ops);

-- Create function to match court decisions by similarity
CREATE OR REPLACE FUNCTION match_court_decisions(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  decision_id TEXT,
  numero TEXT,
  juridiction TEXT,
  chambre TEXT,
  date_decision DATE,
  solution TEXT,
  resume TEXT,
  sommaire TEXT,
  source_url TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    court_decisions.id,
    court_decisions.decision_id,
    court_decisions.numero,
    court_decisions.juridiction,
    court_decisions.chambre,
    court_decisions.date_decision,
    court_decisions.solution,
    court_decisions.resume,
    court_decisions.sommaire,
    court_decisions.source_url,
    1 - (court_decisions.embedding <=> query_embedding) AS similarity
  FROM court_decisions
  WHERE 1 - (court_decisions.embedding <=> query_embedding) > match_threshold
  ORDER BY court_decisions.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Enable RLS (Row Level Security) if needed
ALTER TABLE court_decisions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access (adjust as needed)
CREATE POLICY "Allow public read access" ON court_decisions
  FOR SELECT USING (true);

-- Create policy to allow service role full access
CREATE POLICY "Allow service role full access" ON court_decisions
  FOR ALL USING (auth.role() = 'service_role');
