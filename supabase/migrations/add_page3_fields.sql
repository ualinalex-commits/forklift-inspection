-- Migration: add additional_comments and diagram_annotation_url to daily_inspection_entries
-- Run in Supabase SQL editor or via supabase db push.

ALTER TABLE daily_inspection_entries
  ADD COLUMN IF NOT EXISTS additional_comments      text,
  ADD COLUMN IF NOT EXISTS diagram_annotation_url   text;
