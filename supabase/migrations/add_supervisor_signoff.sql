-- Migration: add supervisor sign-off fields to daily_inspection_entries
-- Run in Supabase SQL editor or via supabase db push.

ALTER TABLE daily_inspection_entries
  ADD COLUMN IF NOT EXISTS supervisor_name text,
  ADD COLUMN IF NOT EXISTS supervisor_signature_url text,
  ADD COLUMN IF NOT EXISTS supervisor_sign_date date;
