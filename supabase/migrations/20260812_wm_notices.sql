-- WatchMov — central de avisos sincronizada entre aparelhos (sino do topo).
-- Espelha o registro local (localStorage) por usuário: o web vê o que o APK
-- gerou (download concluído, MP4 falhou…) e vice-versa.
-- Projeto nnvwpgpvzysvyntdrtay. Idempotente. Cria em public E staging
-- (mesmo padrão do 20260702_wm_playback_errors.sql). RLS por user_id.

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','staging'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.wm_notices (
        id      text NOT NULL,              -- mesmo id do registro local
        user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
        at      timestamptz NOT NULL DEFAULT now(),
        kind    text NOT NULL,              -- release | download | mp4
        title   text NOT NULL,
        body    text,
        error   boolean NOT NULL DEFAULT false,
        read    boolean NOT NULL DEFAULT false,
        ref     text,                       -- mesma tarefa → aviso substituído
        PRIMARY KEY (user_id, id)
      );
    $f$, s);

    EXECUTE format('ALTER TABLE %I.wm_notices ENABLE ROW LEVEL SECURITY;', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_wm_notices_user ON %I.wm_notices(user_id, at DESC);', s);

    -- policies idempotentes (usuário só mexe nos próprios avisos)
    EXECUTE format('DROP POLICY IF EXISTS wm_notices_select ON %I.wm_notices;', s);
    EXECUTE format('CREATE POLICY wm_notices_select ON %I.wm_notices FOR SELECT USING (auth.uid() = user_id);', s);
    EXECUTE format('DROP POLICY IF EXISTS wm_notices_insert ON %I.wm_notices;', s);
    EXECUTE format('CREATE POLICY wm_notices_insert ON %I.wm_notices FOR INSERT WITH CHECK (auth.uid() = user_id);', s);
    EXECUTE format('DROP POLICY IF EXISTS wm_notices_update ON %I.wm_notices;', s);
    EXECUTE format('CREATE POLICY wm_notices_update ON %I.wm_notices FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);', s);
    EXECUTE format('DROP POLICY IF EXISTS wm_notices_delete ON %I.wm_notices;', s);
    EXECUTE format('CREATE POLICY wm_notices_delete ON %I.wm_notices FOR DELETE USING (auth.uid() = user_id);', s);
  END LOOP;
END $$;

-- Recarrega o cache do PostgREST (expõe a tabela nova imediatamente).
NOTIFY pgrst, 'reload schema';
