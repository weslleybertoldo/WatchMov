-- WatchMov — "Remover da lista" do Continuar assistindo (pedido dele 07/11/2026). Idempotente.
-- O título sai da fileira até ser assistido de novo (last_watched_at mais novo que continue_hidden_at); o progresso e os
-- episódios marcados ficam como estão. Coluna nos dois ambientes: public (produção) e staging (schema do site de teste).
ALTER TABLE public.wm_items ADD COLUMN IF NOT EXISTS continue_hidden_at timestamptz;
ALTER TABLE staging.wm_items ADD COLUMN IF NOT EXISTS continue_hidden_at timestamptz;
NOTIFY pgrst, 'reload schema';
