import { useEffect, useState } from 'react';

// Servidor FAVORITO (aba "Servidores" do Painel — pedido do Weslley 07/09/2026).
// O favorito é a fonte que o "Assistir" abre por padrão. Antes o padrão era fixo
// (Fonte 6 EmbedMovies, e antes dela SuperFlix); agora ele escolhe na aba e o
// VideoPlayer lê daqui. A fonte escolhida NUM título (watchmov_src_*) continua
// valendo por cima do favorito — ela existe justamente pros títulos que só têm
// em outra fonte.
export const FAVORITE_SERVER_KEY = 'watchmov_fav_server';
export const DEFAULT_SERVER_ID = 'embedmovies';   // Fonte 6 — padrão quando não há favorito

const EVT = 'watchmov:fav-server';

export function loadFavoriteServer(): string | null {
  try { return localStorage.getItem(FAVORITE_SERVER_KEY); } catch { return null; }
}

export function saveFavoriteServer(id: string): void {
  try { localStorage.setItem(FAVORITE_SERVER_KEY, id); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVT, { detail: id })); } catch { /* ignore */ }
}

// Fonte padrão pro título: favorito (se a fonte existe pro título) → Fonte 6 →
// Fonte 2 (SuperFlix) → 1ª disponível. `available` = PROVIDERS que montam URL pro
// título (algumas exigem imdbId).
export function pickDefaultServer<T extends { id: string }>(available: T[], favorite: string | null | undefined): string | undefined {
  const has = (id: string | null | undefined) => !!id && available.some(p => p.id === id);
  if (has(favorite)) return favorite as string;
  if (has(DEFAULT_SERVER_ID)) return DEFAULT_SERVER_ID;
  if (has('superflix')) return 'superflix';
  return available[0]?.id;
}

// Id efetivo do favorito (com o padrão quando nunca marcou) — pra tela marcar a linha.
export function effectiveFavoriteServer(): string {
  return loadFavoriteServer() ?? DEFAULT_SERVER_ID;
}

// Hook reativo: a aba Servidores re-renderiza ao marcar outro favorito.
export function useFavoriteServer(): string {
  const [fav, setFav] = useState(effectiveFavoriteServer);
  useEffect(() => {
    const fn = () => setFav(effectiveFavoriteServer());
    window.addEventListener(EVT, fn);
    return () => window.removeEventListener(EVT, fn);
  }, []);
  return fav;
}

// "Fonte 6 (EmbedMovies)" a partir de name "Fonte 6 (EmbedMovies PT-BR)" + tag.
export function serverLabel(p: { name: string; tag: string }): string {
  const short = p.name.split(' (')[0].trim();
  return `${short} (${p.tag})`;
}
