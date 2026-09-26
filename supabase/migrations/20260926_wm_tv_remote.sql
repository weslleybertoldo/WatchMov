-- WatchMov — enviar título pro app da TV + renomear/remover TV (pedido dele 26/09/2026). Idempotente.
-- Tabela única em public, como a wm_tv_devices (vale pra staging e prod).

-- Renomear: a TV reescreve `name` ("Fire TV") toda vez que se anota; o nome dado no celular fica à parte.
ALTER TABLE public.wm_tv_devices ADD COLUMN IF NOT EXISTS custom_name text;

-- Mesma assinatura de antes; o nome que sai é o do celular quando existe.
CREATE OR REPLACE FUNCTION public.wm_tv_devices_live(uid uuid)
RETURNS TABLE (session_id uuid, name text, model text, created_at timestamptz, last_seen_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  DELETE FROM public.wm_tv_devices d
   WHERE d.user_id = uid AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = d.session_id);
  RETURN QUERY
    SELECT d.session_id, coalesce(d.custom_name, d.name), d.model, d.created_at, d.last_seen_at
      FROM public.wm_tv_devices d WHERE d.user_id = uid ORDER BY d.last_seen_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.wm_tv_devices_live(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wm_tv_devices_live(uuid) TO service_role;

-- Remover: tira a TV da conta derrubando a sessão dela (refresh tokens caem junto, ON DELETE CASCADE).
-- Só apaga sessão que é uma TV anotada DESTA conta — nunca a do celular ou de outra pessoa.
CREATE OR REPLACE FUNCTION public.wm_tv_device_remove(uid uuid, sid uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  achou boolean;
BEGIN
  DELETE FROM public.wm_tv_devices WHERE user_id = uid AND session_id = sid RETURNING true INTO achou;
  IF achou THEN
    DELETE FROM auth.sessions WHERE id = sid AND user_id = uid;
  END IF;
  RETURN coalesce(achou, false);
END $$;
REVOKE ALL ON FUNCTION public.wm_tv_device_remove(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wm_tv_device_remove(uuid, uuid) TO service_role;

-- Canal privado do Realtime `wm-tv:<user_id>`: o celular manda "abrir título" e a TV responde. Só quem está
-- logado nesta conta entra e fala no tópico dela.
DROP POLICY IF EXISTS wm_tv_canal_ler ON realtime.messages;
CREATE POLICY wm_tv_canal_ler ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'broadcast'
         AND (SELECT realtime.topic()) = 'wm-tv:' || (SELECT auth.uid())::text);

DROP POLICY IF EXISTS wm_tv_canal_enviar ON realtime.messages;
CREATE POLICY wm_tv_canal_enviar ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (realtime.messages.extension = 'broadcast'
              AND (SELECT realtime.topic()) = 'wm-tv:' || (SELECT auth.uid())::text);
