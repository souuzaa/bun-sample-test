-- Database initialization script for Extreme Performance Architecture
-- This script runs automatically when PostgreSQL container starts

-- ============================================================
-- Enable useful extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- Users table with proper indexes
-- ============================================================
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Covering index for common query pattern (email lookup returning name)
CREATE INDEX idx_users_email ON users(email) INCLUDE (name);

-- ============================================================
-- Workload simulation tables
-- ============================================================

-- Hash jobs table for CPU-intensive workload tracking
CREATE TABLE hash_jobs (
  id SERIAL PRIMARY KEY,
  input_data TEXT NOT NULL,
  hash_result VARCHAR(128),
  iterations INTEGER DEFAULT 1000,
  processing_time_ms FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Payloads table for bandwidth-intensive workload tracking
CREATE TABLE payloads (
  id SERIAL PRIMARY KEY,
  size_kb INTEGER NOT NULL,
  data BYTEA,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes for workload status queries
-- ============================================================
CREATE INDEX idx_hash_jobs_created ON hash_jobs(created_at DESC);
CREATE INDEX idx_payloads_created ON payloads(created_at DESC);

-- ============================================================
-- Trigger function to auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users table
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Seed data
-- ============================================================

-- Generate 1000 users
INSERT INTO users (name, email, created_at)
SELECT
  'User ' || i,
  'user' || i || '@example.com',
  NOW() - (random() * interval '365 days')
FROM generate_series(1, 1000) AS i;

-- Generate 5000 hash jobs with realistic data
INSERT INTO hash_jobs (input_data, hash_result, iterations, processing_time_ms, created_at)
SELECT
  'benchmark-data-' || i || '-' || md5(random()::text),
  md5(random()::text) || md5(random()::text),
  (random() * 50000 + 10000)::integer,
  random() * 100 + 5,
  NOW() - (random() * interval '30 days')
FROM generate_series(1, 5000) AS i;

-- Generate 2000 payload records
INSERT INTO payloads (size_kb, data, created_at)
SELECT
  (random() * 490 + 10)::integer,
  decode(repeat(md5(random()::text), 10), 'hex'),
  NOW() - (random() * interval '30 days')
FROM generate_series(1, 2000) AS i;
