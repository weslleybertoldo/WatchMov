-- WatchMov — ambiente de STAGING via schema separado (espelha public.wm_*)
-- Projeto Supabase: nnvwpgpvzysvyntdrtay (compartilhado com voo-watch).
-- NÃO toca public.wm_* nem voo_*. Idempotente. Padrão seazone-support-hub.

CREATE SCHEMA IF NOT EXISTS staging;

CREATE TABLE IF NOT EXISTS staging.wm_sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT '📁'::text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.wm_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section_id       uuid REFERENCES staging.wm_sections(id) ON DELETE CASCADE,
  title            text NOT NULL,
  type             text NOT NULL,
  total_duration   integer,
  watched_duration integer DEFAULT 0,
  completed        boolean DEFAULT false,
  seasons          jsonb,
  comment          text,
  last_watched_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  tmdb_id          integer,
  imdb_id          text,
  poster_url       text,
  synopsis         text,
  genre            text,
  favorite         boolean NOT NULL DEFAULT false,
  rating           numeric,
  votes            integer,
  CONSTRAINT wm_items_type_check CHECK (type = ANY (ARRAY['movie'::text, 'series'::text]))
);

CREATE INDEX IF NOT EXISTS idx_wm_items_user    ON staging.wm_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wm_items_section ON staging.wm_items(section_id);
CREATE INDEX IF NOT EXISTS idx_wm_sections_user ON staging.wm_sections(user_id);

ALTER TABLE staging.wm_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.wm_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own sections" ON staging.wm_sections;
CREATE POLICY "Users manage own sections" ON staging.wm_sections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own items" ON staging.wm_items;
CREATE POLICY "Users manage own items" ON staging.wm_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- grants (RLS faz o gating real, igual ao schema public)
GRANT USAGE ON SCHEMA staging TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA staging TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA staging TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA staging GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
