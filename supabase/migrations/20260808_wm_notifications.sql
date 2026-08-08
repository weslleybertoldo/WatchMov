-- WatchMov — notificações de lançamento (novo episódio / estreia de filme).
-- Projeto Supabase: nnvwpgpvzysvyntdrtay. Idempotente. Cria em public E staging
-- (mesmo padrão do 20260702_wm_playback_errors.sql). RLS por user_id.
--
-- wm_push_tokens: token FCM por dispositivo do usuário.
-- wm_notify_subs: o "sino" por título. A REGRA (definida pelo Weslley):
--   entrar na Minha Lista  -> cria com enabled=true
--   desmarcar o sino       -> enabled=false (continua desligado mesmo na lista)
--   sair da lista          -> a linha é APAGADA (re-adicionar volta a ligar)
--   clique manual          -> liga/desliga, dentro ou fora da lista

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','staging'] LOOP
    EXECUTE format($f$
      CREATE TABLE IF NOT EXISTS %I.wm_push_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
        token       text NOT NULL UNIQUE,
        platform    text NOT NULL DEFAULT 'android',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS %I.wm_notify_subs (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
        tmdb_id           integer NOT NULL,
        type              text NOT NULL CHECK (type IN ('movie','tv')),
        enabled           boolean NOT NULL DEFAULT true,
        title             text,
        poster_url        text,
        last_notified_key text,        -- dedup: 's2e3' (série) ou 'released' (filme)
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, tmdb_id, type)
      );

      CREATE INDEX IF NOT EXISTS wm_notify_subs_enabled_idx ON %I.wm_notify_subs (enabled) WHERE enabled;
      CREATE INDEX IF NOT EXISTS wm_push_tokens_user_idx ON %I.wm_push_tokens (user_id);

      ALTER TABLE %I.wm_push_tokens ENABLE ROW LEVEL SECURITY;
      ALTER TABLE %I.wm_notify_subs ENABLE ROW LEVEL SECURITY;
    $f$, s, s, s, s, s, s);

    -- Políticas: cada usuário só enxerga/mexe no que é dele (CREATE POLICY não
    -- aceita IF NOT EXISTS em versões antigas -> DROP antes).
    EXECUTE format('DROP POLICY IF EXISTS wm_push_tokens_own ON %I.wm_push_tokens', s);
    EXECUTE format($f$
      CREATE POLICY wm_push_tokens_own ON %I.wm_push_tokens
        FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())
    $f$, s);

    EXECUTE format('DROP POLICY IF EXISTS wm_notify_subs_own ON %I.wm_notify_subs', s);
    EXECUTE format($f$
      CREATE POLICY wm_notify_subs_own ON %I.wm_notify_subs
        FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())
    $f$, s);
  END LOOP;
END $$;
