-- WatchMov — registro de erros de reprodução (aba "Bugs" nas Configurações).
-- Projeto Supabase: nnvwpgpvzysvyntdrtay. Idempotente. Cria em public E staging
-- (mesmo padrão do 20260618_watchmov_schema_staging.sql). RLS por user_id.

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','staging'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.wm_playback_errors (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
        created_at  timestamptz NOT NULL DEFAULT now(),
        title       text,
        provider    text,       -- fonte do embed (ex.: superflix, embedplayapi)
        url         text,       -- link do stream que falhou
        referer     text,
        mime        text,
        error_code  integer,    -- ExoPlaybackException.errorCode
        error_name  text,       -- getErrorCodeName() (ex.: ERROR_CODE_IO_BAD_HTTP_STATUS)
        error_cause text,       -- classe + mensagem da causa (ex.: "InvalidResponseCodeException: 403")
        quality     text,
        app_version text,
        platform    text
      );
    $f$, s);

    EXECUTE format('ALTER TABLE %I.wm_playback_errors ENABLE ROW LEVEL SECURITY;', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_wm_pberr_user ON %I.wm_playback_errors(user_id, created_at DESC);', s);

    -- policies idempotentes (usuário só vê/insere/apaga os próprios erros)
    EXECUTE format('DROP POLICY IF EXISTS wm_pberr_select ON %I.wm_playback_errors;', s);
    EXECUTE format('CREATE POLICY wm_pberr_select ON %I.wm_playback_errors FOR SELECT USING (auth.uid() = user_id);', s);
    EXECUTE format('DROP POLICY IF EXISTS wm_pberr_insert ON %I.wm_playback_errors;', s);
    EXECUTE format('CREATE POLICY wm_pberr_insert ON %I.wm_playback_errors FOR INSERT WITH CHECK (auth.uid() = user_id);', s);
    EXECUTE format('DROP POLICY IF EXISTS wm_pberr_delete ON %I.wm_playback_errors;', s);
    EXECUTE format('CREATE POLICY wm_pberr_delete ON %I.wm_playback_errors FOR DELETE USING (auth.uid() = user_id);', s);
  END LOOP;
END $$;

-- Recarrega o cache do PostgREST (expõe a tabela nova imediatamente).
NOTIFY pgrst, 'reload schema';
