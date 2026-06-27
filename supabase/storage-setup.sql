-- ============================================================
-- SUPABASE STORAGE BUCKETS + POLICIES
-- Run in Supabase SQL editor after schema.sql
-- ============================================================

-- weekly-reports: public read, service-role write
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('weekly-reports', 'weekly-reports', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "weekly-reports: public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'weekly-reports');
CREATE POLICY "weekly-reports: service role insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'weekly-reports');
CREATE POLICY "weekly-reports: service role update"
  ON storage.objects FOR UPDATE USING (bucket_id = 'weekly-reports');
CREATE POLICY "weekly-reports: service role delete"
  ON storage.objects FOR DELETE USING (bucket_id = 'weekly-reports');

-- forklift-photos: public read, anon insert
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('forklift-photos', 'forklift-photos', true, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/heic'])
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "forklift-photos: public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'forklift-photos');
CREATE POLICY "forklift-photos: anon insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'forklift-photos');
CREATE POLICY "forklift-photos: anon upsert"
  ON storage.objects FOR UPDATE USING (bucket_id = 'forklift-photos');

-- signatures: public read, anon insert
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signatures', 'signatures', true, 5242880, ARRAY['image/png'])
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "signatures: public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'signatures');
CREATE POLICY "signatures: anon insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'signatures');
CREATE POLICY "signatures: anon upsert"
  ON storage.objects FOR UPDATE USING (bucket_id = 'signatures');

-- thorough-exams: public read, anon insert
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('thorough-exams', 'thorough-exams', true, 20971520,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "thorough-exams: public read"
  ON storage.objects FOR SELECT USING (bucket_id = 'thorough-exams');
CREATE POLICY "thorough-exams: anon insert"
  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'thorough-exams');
CREATE POLICY "thorough-exams: anon upsert"
  ON storage.objects FOR UPDATE USING (bucket_id = 'thorough-exams');
