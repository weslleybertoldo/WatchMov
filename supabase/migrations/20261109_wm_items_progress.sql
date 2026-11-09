-- WatchMov — o minuto onde parou vale em todos os aparelhos (pedido dele 09/11/2026: filme e série). Idempotente.
-- Último ponto tocado do título, venha do aparelho que vier: {"s": temporada, "e": episódio, "pos": ms, "dur": ms,
-- "ts": epoch ms de quando tocou} (filme: s = e = 0). O aparelho grava enquanto toca (no máximo a cada 30 s) e ao fechar
-- o player; ao abrir o título vale o mais novo entre este e o que está guardado no aparelho (src/lib/progressoRemoto.ts).
-- Coluna nos dois ambientes: public (produção) e staging (schema do site de teste).
ALTER TABLE public.wm_items ADD COLUMN IF NOT EXISTS progress jsonb;
ALTER TABLE staging.wm_items ADD COLUMN IF NOT EXISTS progress jsonb;
NOTIFY pgrst, 'reload schema';
