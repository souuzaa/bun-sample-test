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
-- Seed data
-- ============================================================
INSERT INTO users (name, email) VALUES
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');

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
