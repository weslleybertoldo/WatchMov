-- WatchMov — login na TV pelo celular (W2 do app do Fire TV). Idempotente.
-- A TV pede um código (6 letras, vale 5 min) e mostra num QR; o celular logado aprova; a TV busca
-- o token 1× com o segredo que só ela conhece e entra (verifyOtp). Quem mexe aqui é só a edge
-- function tv-pair (service role): RLS ligada e NENHUMA policy = anon/authenticated não leem nada.
-- Tabela única em public (sem cópia em staging): é pareamento de login, vale pros dois ambientes.

CREATE TABLE IF NOT EXISTS public.wm_tv_pair (
  code         text PRIMARY KEY,
  secret_hash  text NOT NULL,                 -- sha256 do segredo da TV (o QR leva só o código)
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash   text,                          -- link mágico da conta que aprovou; sai 1× no poll
  approved_at  timestamptz,
  used_at      timestamptz
);

ALTER TABLE public.wm_tv_pair ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wm_tv_pair FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS wm_tv_pair_expires_idx ON public.wm_tv_pair (expires_at);

-- TVs conectadas (pedido dele 26/09/2026: "Aba entrar na tv precisa ter os aparelhos conectados").
-- A TV se registra depois de entrar (edge tv-pair, action register, com o JWT dela); a chave é a
-- sessão do Supabase da TV (claim session_id). Mesma regra: só a edge mexe (RLS sem policy).
CREATE TABLE IF NOT EXISTS public.wm_tv_devices (
  session_id   uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,                 -- "Fire TV", "TV Android"
  model        text,                          -- Build.MODEL da TV (AFTSSS, t950s_be311…)
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wm_tv_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wm_tv_devices FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS wm_tv_devices_user_idx ON public.wm_tv_devices (user_id);

-- Conectada = registrada E com a sessão ainda viva (Sair na TV apaga a sessão → sai da lista aqui).
CREATE OR REPLACE FUNCTION public.wm_tv_devices_live(uid uuid)
RETURNS TABLE (session_id uuid, name text, model text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.wm_tv_devices d
   WHERE d.user_id = uid AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = d.session_id);
  RETURN QUERY
    SELECT d.session_id, d.name, d.model, d.created_at, d.last_seen_at
      FROM public.wm_tv_devices d WHERE d.user_id = uid ORDER BY d.last_seen_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.wm_tv_devices_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wm_tv_devices_live(uuid) TO service_role;
