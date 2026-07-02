-- ============================================================
-- FORKLIFT PRE-USE INSPECTION — COMPLETE DATABASE SCHEMA
-- Telehandler PL054-OP-V3  |  Mon–Sat  |  No G/P split
--
-- Run once in Supabase SQL editor.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT.
-- Order matters — foreign keys require parent tables to exist first.
-- ============================================================


-- ===========================================================
-- SECTION 1 — TABLES
-- ===========================================================

-- 1.1  sites
-- One row per physical construction/warehouse site.
CREATE TABLE IF NOT EXISTS sites (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  location     text,
  postcode     text,
  manager_name text,
  qr_code_url  text,                       -- set after INSERT: /site/{id}
  is_archived  boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 1.2  forklifts
-- One row per machine.  Renamed from 'mewps' in the original MEWP app.
CREATE TABLE IF NOT EXISTS forklifts (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                   uuid        NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  machine_ref               text        NOT NULL,        -- e.g. "TH-01"
  model                     text,
  serial_number             text,
  nfc_url                   text,                        -- set after INSERT: /check/{id}
  active                    boolean     NOT NULL DEFAULT true,
  is_archived               boolean     NOT NULL DEFAULT false,
  thorough_exam_url         text,
  thorough_exam_expiry      date,
  thorough_exam_filename    text,
  thorough_exam_uploaded_at timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS forklifts_site_id_idx    ON forklifts (site_id);
CREATE INDEX IF NOT EXISTS forklifts_is_archived_idx ON forklifts (is_archived);
CREATE INDEX IF NOT EXISTS forklifts_active_idx      ON forklifts (active);

-- 1.3  user_profiles
-- Admin accounts linked 1-to-1 with Supabase Auth users.
-- Must be created AFTER the auth schema exists (always true in Supabase).
CREATE TABLE IF NOT EXISTS user_profiles (
  id                   uuid    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 text,
  email                text,
  role                 text    NOT NULL,     -- 'main_admin' | 'site_admin'
  site_id              uuid    REFERENCES sites(id),
  must_change_password boolean NOT NULL DEFAULT true,
  is_archived          boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS user_profiles_role_idx    ON user_profiles (role);
CREATE INDEX IF NOT EXISTS user_profiles_site_id_idx ON user_profiles (site_id);

-- 1.4  weekly_inspection_sheets
-- One sheet per forklift per Mon–Sat week.
-- Created automatically by get_or_create_weekly_sheet() RPC.
CREATE TABLE IF NOT EXISTS weekly_inspection_sheets (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  forklift_id              uuid        NOT NULL REFERENCES forklifts(id) ON DELETE CASCADE,
  site_id                  uuid        NOT NULL REFERENCES sites(id),
  machine_ref              text        NOT NULL,  -- snapshot at creation time
  week_commencing          date        NOT NULL,  -- always a Monday
  week_ending              date        NOT NULL,  -- always a Saturday (Mon + 5)
  supervisor_signoff_1_name  text,
  supervisor_signoff_1_date  date,
  supervisor_signoff_2_name  text,
  supervisor_signoff_2_date  date,
  pdf_url                  text,                  -- null until first PDF generated
  pdf_generated_at         timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_sheet_forklift_week UNIQUE (forklift_id, week_commencing)
);

CREATE INDEX IF NOT EXISTS wis_site_id_idx         ON weekly_inspection_sheets (site_id);
CREATE INDEX IF NOT EXISTS wis_forklift_id_idx     ON weekly_inspection_sheets (forklift_id);
CREATE INDEX IF NOT EXISTS wis_week_commencing_idx ON weekly_inspection_sheets (week_commencing);

-- 1.5  daily_inspection_entries
-- One row per forklift per calendar day. Tyre PSI columns are telehandler-specific.
CREATE TABLE IF NOT EXISTS daily_inspection_entries (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id        uuid        NOT NULL REFERENCES weekly_inspection_sheets(id) ON DELETE CASCADE,
  forklift_id     uuid        NOT NULL REFERENCES forklifts(id),
  site_id         uuid        NOT NULL REFERENCES sites(id),
  inspection_date date        NOT NULL,
  day_of_week     text        NOT NULL,  -- 'monday' … 'saturday'
  operator_name   text        NOT NULL,
  pal_card_number text,
  forklift_owner  text,                  -- hire company if applicable
  initialled      boolean     NOT NULL DEFAULT true,
  daily_status    text,                  -- 'pending' | 'ok' | 'fault'
  submitted_at    timestamptz,
  photo_url       text,
  signature_url   text,
  -- Tyre pressure readings (PSI) — Mon–Sat telehandler PL054-OP-V3
  tyre_fl_psi     numeric(5,1),          -- front-left
  tyre_fr_psi     numeric(5,1),          -- front-right
  tyre_rl_psi     numeric(5,1),          -- rear-left
  tyre_rr_psi     numeric(5,1),          -- rear-right

  CONSTRAINT uq_entry_forklift_date UNIQUE (forklift_id, inspection_date)
);

CREATE INDEX IF NOT EXISTS die_forklift_date_idx ON daily_inspection_entries (forklift_id, inspection_date);
CREATE INDEX IF NOT EXISTS die_site_id_idx       ON daily_inspection_entries (site_id);
CREATE INDEX IF NOT EXISTS die_sheet_id_idx      ON daily_inspection_entries (sheet_id);

-- 1.6  visual_check_results
-- 20 rows per inspection (items 1–20), single result per item.
CREATE TABLE IF NOT EXISTS visual_check_results (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid  NOT NULL REFERENCES daily_inspection_entries(id) ON DELETE CASCADE,
  sheet_id        uuid  NOT NULL REFERENCES weekly_inspection_sheets(id),
  forklift_id     uuid  NOT NULL REFERENCES forklifts(id),
  inspection_date date  NOT NULL,
  item_number     int   NOT NULL,   -- 1–20
  category        text,             -- 'documentation' | 'tyres_wheels' | etc.
  result          text  NOT NULL    -- 'pass' | 'fail' | 'na'
);

CREATE INDEX IF NOT EXISTS vcr_sheet_id_idx   ON visual_check_results (sheet_id);
CREATE INDEX IF NOT EXISTS vcr_entry_id_idx   ON visual_check_results (entry_id);
CREATE INDEX IF NOT EXISTS vcr_forklift_idx   ON visual_check_results (forklift_id, inspection_date);

-- 1.7  function_check_results
-- 10 rows per inspection (items 21–30).
-- Single result per item — no G/P split (telehandler has one operator position).
CREATE TABLE IF NOT EXISTS function_check_results (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid  NOT NULL REFERENCES daily_inspection_entries(id) ON DELETE CASCADE,
  sheet_id        uuid  NOT NULL REFERENCES weekly_inspection_sheets(id),
  forklift_id     uuid  NOT NULL REFERENCES forklifts(id),
  inspection_date date  NOT NULL,
  item_number     int   NOT NULL,   -- 21–30
  result          text  NOT NULL    -- 'pass' | 'fail' | 'na'
);

CREATE INDEX IF NOT EXISTS fcr_sheet_id_idx ON function_check_results (sheet_id);
CREATE INDEX IF NOT EXISTS fcr_entry_id_idx ON function_check_results (entry_id);
CREATE INDEX IF NOT EXISTS fcr_forklift_idx ON function_check_results (forklift_id, inspection_date);

-- 1.8  defect_log
-- One row per failed check item per inspection.
-- Status progresses: open → reported → repaired → closed.
CREATE TABLE IF NOT EXISTS defect_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid        NOT NULL REFERENCES daily_inspection_entries(id) ON DELETE CASCADE,
  sheet_id        uuid        NOT NULL REFERENCES weekly_inspection_sheets(id),
  forklift_id     uuid        NOT NULL REFERENCES forklifts(id),
  site_id         uuid        NOT NULL REFERENCES sites(id),
  inspection_date date        NOT NULL,
  item_number     int         NOT NULL,
  check_type      text        NOT NULL,  -- 'visual' | 'function'
  defect_details  text,
  date_noted      date,
  date_reported   date,
  engineer_name   text,
  date_repaired   date,
  further_notes   text,
  status          text        NOT NULL DEFAULT 'open',  -- 'open' | 'reported' | 'repaired' | 'closed'
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dl_site_id_idx     ON defect_log (site_id);
CREATE INDEX IF NOT EXISTS dl_forklift_id_idx ON defect_log (forklift_id);
CREATE INDEX IF NOT EXISTS dl_sheet_id_idx    ON defect_log (sheet_id);
CREATE INDEX IF NOT EXISTS dl_status_idx      ON defect_log (status);

-- 1.9  check_items
-- Static reference table.  30 items for telehandler PL054-OP-V3.
CREATE TABLE IF NOT EXISTS check_items (
  item_number int  PRIMARY KEY,
  check_type  text NOT NULL,   -- 'visual' | 'function'
  category    text NOT NULL,
  description text NOT NULL,
  has_gp      boolean NOT NULL DEFAULT false  -- false for all items (no G/P split)
);

-- Wording matches the printed rows on the PL054-OP-V3 Telehandler Inspection
-- Checklist template (see lib/generateReport.js VIS_ROWS / FUNC_ROWS) and the
-- SECTIONS/FUNCTION_CHECKS in pages/check/[forkliftId].jsx. Item 30 does not
-- exist on the current template revision; item 31 (Accessories) replaces it.
INSERT INTO check_items (item_number, check_type, category, description, has_gp) VALUES
  -- Visual checks 1–20 ("On the Machine, Outside the Cab" / "Engine Compartment" / "Inside the Cab")
  ( 1, 'visual', 'outside_cab',        'Mirrors — clean, no damage, properly adjusted',                                                          false),
  ( 2, 'visual', 'outside_cab',        'Windows — clean, no damage, front and top',                                                              false),
  ( 3, 'visual', 'outside_cab',        'Windshield wipers — arm and rubber blade intact',                                                        false),
  ( 4, 'visual', 'outside_cab',        'Forks — no damage, cracks or misalignment; check welds, locking pins in place and secure',               false),
  ( 5, 'visual', 'outside_cab',        'Warning decals — present, legible, not damaged',                                                         false),
  ( 6, 'visual', 'outside_cab',        'Tyres — no damage, bulges, correct ply rating',                                                          false),
  ( 7, 'visual', 'outside_cab',        'Wheels — no loose lug bolts, bent rims or cracks',                                                       false),
  ( 8, 'visual', 'outside_cab',        'Differentials — no oil leaks or cracks in housing',                                                      false),
  ( 9, 'visual', 'outside_cab',        'Guards and covers — no damage, all in place',                                                            false),
  (10, 'visual', 'outside_cab',        'Steps and handrail — no damage, clean',                                                                  false),
  (11, 'visual', 'outside_cab',        'Stabiliser arms, cylinders, pads — no damage or oil leaks, cylinder rod condition, no missing bolts',    false),
  (12, 'visual', 'outside_cab',        'Battery / terminals — cable connections secure, no water ingress, clean — no corrosion',                 false),
  (13, 'visual', 'outside_cab',        'Overall machine — no loose/missing nuts or bolts, guards secure, no damage, clean',                      false),
  (14, 'visual', 'engine_compartment', 'Air filter — check restriction indicator',                                                               false),
  (15, 'visual', 'engine_compartment', 'Radiator fin — no blockage, leaks; clean',                                                                false),
  (16, 'visual', 'engine_compartment', 'All hoses — no cracks, wear spots or leaks',                                                              false),
  (17, 'visual', 'engine_compartment', 'All belts — check tightness, wear, cracks, delamination',                                                false),
  (18, 'visual', 'engine_compartment', 'Overall engine compartment — no rubbish or dirt build-up, no leaks',                                     false),
  (19, 'visual', 'inside_cab',         'ROPS or FOPS — no damage, no loose bolts',                                                                false),
  (20, 'visual', 'inside_cab',         'Seat — adjustment and pedal travel correct',                                                              false),
  -- Function checks 21–29, 31 (single tick — no G/P split)
  (21, 'function', 'inside_cab', 'Seat belt & mounting — no damage or wear, adjusts and functions correctly',                                   false),
  (22, 'function', 'inside_cab', 'Fire extinguisher — charge OK, no damage, inspection card in date',                                            false),
  (23, 'function', 'inside_cab', 'Horn, backup alarm, lights, wipers — proper function',                                                          false),
  (24, 'function', 'inside_cab', 'Controls, gauge lenses — proper function, clean',                                                               false),
  (25, 'function', 'inside_cab', 'Overall cab — interior cleanliness',                                                                            false),
  (26, 'function', 'driver',     'Training — do you have a current CPCS card for the item of plant you are operating?',                          false),
  (27, 'function', 'driver',     'Familiarisation — are you familiar with the model of telehandler, its functions and controls, and any attachments you are using?', false),
  (28, 'function', 'driver',     'Supervision — do you know who your supervisor is?',                                                            false),
  (29, 'function', 'driver',     'Fit and well to carry out work — are you?',                                                                    false),
  (31, 'function', 'accessories','Slings, bin handlers, chains etc — suitable storage, free from damage, good condition',                        false)
ON CONFLICT (item_number) DO UPDATE SET
  description = EXCLUDED.description,
  category    = EXCLUDED.category,
  check_type  = EXCLUDED.check_type,
  has_gp      = EXCLUDED.has_gp;

DELETE FROM check_items WHERE item_number = 30;


-- ===========================================================
-- SECTION 2 — RPC FUNCTIONS
-- ===========================================================

-- 2.1  get_week_commencing
-- Returns the Monday of the ISO week that contains p_date.
-- date_trunc('week', ...) always returns Monday in PostgreSQL.
CREATE OR REPLACE FUNCTION get_week_commencing(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('week', p_date::timestamp)::date;
$$;

-- 2.2  get_or_create_weekly_sheet
-- Finds the existing Mon–Sat sheet for p_date's week, or inserts a new one.
-- Returns the sheet UUID.  Called from the browser (anon key) via supabase.rpc().
-- SECURITY DEFINER lets it INSERT into weekly_inspection_sheets even when
-- the caller is the anon role (which has no INSERT policy on that table).
CREATE OR REPLACE FUNCTION get_or_create_weekly_sheet(
  p_forklift_id uuid,
  p_site_id     uuid,
  p_machine_ref text,
  p_date        date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_week_comm date;
  v_sheet_id  uuid;
BEGIN
  v_week_comm := get_week_commencing(p_date);

  SELECT id INTO v_sheet_id
    FROM weekly_inspection_sheets
   WHERE forklift_id    = p_forklift_id
     AND week_commencing = v_week_comm;

  IF v_sheet_id IS NULL THEN
    INSERT INTO weekly_inspection_sheets
      (forklift_id, site_id, machine_ref, week_commencing, week_ending)
    VALUES
      (p_forklift_id, p_site_id, p_machine_ref, v_week_comm, v_week_comm + 5)
    RETURNING id INTO v_sheet_id;
    -- week_ending = Mon + 5 = Saturday  (telehandler app is Mon–Sat only)
  END IF;

  RETURN v_sheet_id;
END;
$$;


-- ===========================================================
-- SECTION 3 — VIEWS
-- ===========================================================

-- 3.1  today_inspection_status
-- One row per active, non-archived forklift.
-- Left-joins today's entry and counts open defects.
-- Used by the site dashboard for the stats panel and ForkliftCard status pills.
CREATE OR REPLACE VIEW today_inspection_status AS
SELECT
  f.id                                    AS forklift_id,
  f.site_id,
  f.machine_ref,
  f.model,
  f.serial_number,
  f.nfc_url,
  f.thorough_exam_url,
  f.thorough_exam_expiry,
  s.name                                  AS site_name,
  die.id                                  AS entry_id,
  die.operator_name,
  die.pal_card_number,
  die.daily_status,
  die.submitted_at,
  die.photo_url,
  die.signature_url,
  die.id IS NOT NULL                      AS inspected_today,
  COALESCE(
    (SELECT COUNT(*)::int
       FROM defect_log dl
      WHERE dl.entry_id = die.id
        AND dl.status = 'open'),
    0
  )                                       AS open_defect_count
FROM forklifts f
JOIN sites s ON s.id = f.site_id
LEFT JOIN daily_inspection_entries die
       ON die.forklift_id    = f.id
      AND die.inspection_date = CURRENT_DATE
WHERE f.active      = true
  AND f.is_archived = false;

-- 3.2  weekly_sheet_summary
-- Pivots visual and function check results into day columns (Mon–Sat).
-- One row per (sheet_id, item_number, check_type).
-- Used by generateReport.js to fill the PDF grid in one query.
CREATE OR REPLACE VIEW weekly_sheet_summary AS

-- Visual checks (items 1–20)
SELECT
  vcr.sheet_id,
  vcr.forklift_id,
  vcr.item_number,
  'visual'                                                                                           AS check_type,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing         THEN vcr.result END)               AS mon_result,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing + 1     THEN vcr.result END)               AS tue_result,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing + 2     THEN vcr.result END)               AS wed_result,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing + 3     THEN vcr.result END)               AS thu_result,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing + 4     THEN vcr.result END)               AS fri_result,
  MAX(CASE WHEN vcr.inspection_date = ws.week_commencing + 5     THEN vcr.result END)               AS sat_result
FROM visual_check_results vcr
JOIN weekly_inspection_sheets ws ON ws.id = vcr.sheet_id
GROUP BY vcr.sheet_id, vcr.forklift_id, vcr.item_number

UNION ALL

-- Function checks (items 21–30, single result)
SELECT
  fcr.sheet_id,
  fcr.forklift_id,
  fcr.item_number,
  'function'                                                                                         AS check_type,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing         THEN fcr.result END)               AS mon_result,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing + 1     THEN fcr.result END)               AS tue_result,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing + 2     THEN fcr.result END)               AS wed_result,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing + 3     THEN fcr.result END)               AS thu_result,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing + 4     THEN fcr.result END)               AS fri_result,
  MAX(CASE WHEN fcr.inspection_date = ws.week_commencing + 5     THEN fcr.result END)               AS sat_result
FROM function_check_results fcr
JOIN weekly_inspection_sheets ws ON ws.id = fcr.sheet_id
GROUP BY fcr.sheet_id, fcr.forklift_id, fcr.item_number;

-- 3.3  weekly_operator_log
-- One row per (sheet_id, day_of_week) with operator details and tyre pressures.
-- Used by generateReport.js to populate the daily summary pages of the PDF.
CREATE OR REPLACE VIEW weekly_operator_log AS
SELECT
  die.id              AS entry_id,
  die.sheet_id,
  die.forklift_id,
  die.site_id,
  die.day_of_week,
  die.inspection_date,
  die.operator_name,
  die.pal_card_number,
  die.forklift_owner,
  die.daily_status,
  die.submitted_at,
  die.photo_url,
  die.signature_url,
  die.tyre_fl_psi,
  die.tyre_fr_psi,
  die.tyre_rl_psi,
  die.tyre_rr_psi
FROM daily_inspection_entries die;


-- ===========================================================
-- SECTION 4 — ROW LEVEL SECURITY
-- ===========================================================
-- NOTE: The service_role key BYPASSES RLS entirely — no policy is
-- needed to grant it access.  Policies below govern the anon key
-- (unauthenticated public requests) and the authenticated role
-- (logged-in site admins using the anon Supabase client + JWT).

ALTER TABLE sites                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE forklifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_inspection_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_inspection_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE visual_check_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE function_check_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE defect_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_items              ENABLE ROW LEVEL SECURITY;

-- ── sites ──────────────────────────────────────────────────────────────────
-- Public read (site dashboard is a public URL).
-- All writes go through API routes (service_role, bypasses RLS).
DROP POLICY IF EXISTS "sites: public read" ON sites;
CREATE POLICY "sites: public read"
  ON sites FOR SELECT
  USING (true);

-- ── forklifts ──────────────────────────────────────────────────────────────
-- Anon SELECT: only active machines (for the inspection form /check/[id]).
-- Anon INSERT: needed because AddForkliftModal inserts directly from the browser.
-- Anon UPDATE: needed for thorough exam upload (ThoroughExamModal) and nfc_url
--              set immediately after insert in AddForkliftModal.
-- All deletions and hard deactivations go through service_role API routes.
DROP POLICY IF EXISTS "forklifts: anon read"         ON forklifts;
DROP POLICY IF EXISTS "forklifts: anon insert"       ON forklifts;
DROP POLICY IF EXISTS "forklifts: anon update"       ON forklifts;

CREATE POLICY "forklifts: anon read"
  ON forklifts FOR SELECT
  USING (active = true);

CREATE POLICY "forklifts: anon insert"
  ON forklifts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "forklifts: anon update"
  ON forklifts FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ── user_profiles ──────────────────────────────────────────────────────────
-- Authenticated users (logged-in admins) may read their own profile row.
-- This is used by login.jsx and admin/index.jsx to determine role + redirect.
-- All writes go through service_role API routes.
DROP POLICY IF EXISTS "user_profiles: self read" ON user_profiles;
CREATE POLICY "user_profiles: self read"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- ── weekly_inspection_sheets ───────────────────────────────────────────────
-- Public read (site dashboard shows PDF links without auth).
-- INSERT is handled inside get_or_create_weekly_sheet() which runs as
-- SECURITY DEFINER (bypasses RLS), so no anon INSERT policy is required.
-- PDF url updates go through service_role.
DROP POLICY IF EXISTS "wis: public read" ON weekly_inspection_sheets;
CREATE POLICY "wis: public read"
  ON weekly_inspection_sheets FOR SELECT
  USING (true);

-- ── daily_inspection_entries ───────────────────────────────────────────────
-- Workers (anon) INSERT their inspection; the UNIQUE constraint on
-- (forklift_id, inspection_date) prevents double submissions at the DB level.
-- Anon SELECT is needed so the inspection form can check "already done today".
-- Anon DELETE is needed for the rollback in the submit error path.
DROP POLICY IF EXISTS "die: anon read"   ON daily_inspection_entries;
DROP POLICY IF EXISTS "die: anon insert" ON daily_inspection_entries;
DROP POLICY IF EXISTS "die: anon delete" ON daily_inspection_entries;

CREATE POLICY "die: anon read"
  ON daily_inspection_entries FOR SELECT
  USING (true);

CREATE POLICY "die: anon insert"
  ON daily_inspection_entries FOR INSERT
  WITH CHECK (true);

CREATE POLICY "die: anon delete"
  ON daily_inspection_entries FOR DELETE
  USING (true);

-- ── visual_check_results ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "vcr: anon read"   ON visual_check_results;
DROP POLICY IF EXISTS "vcr: anon insert" ON visual_check_results;

CREATE POLICY "vcr: anon read"
  ON visual_check_results FOR SELECT
  USING (true);

CREATE POLICY "vcr: anon insert"
  ON visual_check_results FOR INSERT
  WITH CHECK (true);

-- ── function_check_results ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "fcr: anon read"   ON function_check_results;
DROP POLICY IF EXISTS "fcr: anon insert" ON function_check_results;

CREATE POLICY "fcr: anon read"
  ON function_check_results FOR SELECT
  USING (true);

CREATE POLICY "fcr: anon insert"
  ON function_check_results FOR INSERT
  WITH CHECK (true);

-- ── defect_log ─────────────────────────────────────────────────────────────
-- Workers INSERT faults during submission.
-- Site dashboard reads them for fault display.
-- Status updates (reported → repaired) go through service_role.
DROP POLICY IF EXISTS "dl: anon read"   ON defect_log;
DROP POLICY IF EXISTS "dl: anon insert" ON defect_log;

CREATE POLICY "dl: anon read"
  ON defect_log FOR SELECT
  USING (true);

CREATE POLICY "dl: anon insert"
  ON defect_log FOR INSERT
  WITH CHECK (true);

-- ── check_items ────────────────────────────────────────────────────────────
-- Read-only for all clients.  Writes only via this migration script.
DROP POLICY IF EXISTS "ci: public read" ON check_items;
CREATE POLICY "ci: public read"
  ON check_items FOR SELECT
  USING (true);


-- ===========================================================
-- SECTION 5 — REALTIME PUBLICATION
-- ===========================================================
-- Enable Supabase Realtime for tables that the site dashboard subscribes to.
-- Run each statement individually if the publication already exists.

ALTER PUBLICATION supabase_realtime ADD TABLE forklifts;
ALTER PUBLICATION supabase_realtime ADD TABLE daily_inspection_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE weekly_inspection_sheets;


-- ===========================================================
-- DONE
-- ===========================================================
-- After running this script:
--   1. Run supabase/storage-setup.sql to create the 4 storage buckets.
--   2. Create your main_admin user in the Supabase Auth dashboard.
--   3. INSERT their row into user_profiles:
--
--   INSERT INTO user_profiles (id, name, email, role, must_change_password)
--   VALUES ('<paste-auth-uuid>', 'Your Name', 'you@email.com', 'main_admin', false);
-- ===========================================================
