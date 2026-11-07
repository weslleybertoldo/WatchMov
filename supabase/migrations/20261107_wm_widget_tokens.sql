-- WatchMov — widget do controle remoto na tela inicial do celular (Parte 3 do controle, pedido dele 07/11/2026:
-- "os botões no próprio widget, sem abrir o app"). Idempotente.
-- O widget não tem o login do app (o refresh token da sessão gira a cada uso e derrubaria o login se fosse usado fora
-- dele): o app logado cria um token PRÓPRIO do widget pela edge tv-remote, e o widget manda as teclas com ele.
-- Aqui fica só o sha256 do token. Quem mexe é só a edge (service role): RLS ligada e NENHUMA policy.
-- Tabela única em public, como a wm_tv_devices (vale pra staging e prod).

CREATE TABLE IF NOT EXISTS public.wm_widget_tokens (
  token_hash   text PRIMARY KEY,                -- sha256 do token guardado no celular
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device       text,                            -- modelo do celular (só pra saber de onde é)
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz                      -- regravado no máximo 1×/h (não escreve a cada tecla)
);

ALTER TABLE public.wm_widget_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wm_widget_tokens FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS wm_widget_tokens_user_idx ON public.wm_widget_tokens (user_id, created_at DESC);
