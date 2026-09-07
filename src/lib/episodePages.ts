// Episódios em ABAS de até 12 por temporada (pedido do Weslley 06/09/2026): a T1 de
// um anime longo vira "1-12", "13-24", "25-36"…, com ✓ na aba cujos episódios já foram
// todos assistidos, botões de avançar/voltar aba e a aba aberta lembrada por
// título+temporada ("se eu voltar com a aba 4 aberta, mantém a aba 4").

export const EPISODES_PER_PAGE = 12;

export function pageCount(totalEpisodes: number, per = EPISODES_PER_PAGE): number {
  return Math.max(1, Math.ceil(Math.max(0, totalEpisodes) / per));
}

// Índice (0-based) da aba onde o episódio N mora.
export function pageOfEpisode(episode: number, per = EPISODES_PER_PAGE): number {
  return Math.max(0, Math.ceil(Math.max(1, episode) / per) - 1);
}

export function pageEpisodes(page: number, totalEpisodes: number, per = EPISODES_PER_PAGE): number[] {
  const from = page * per + 1;
  const to = Math.min(totalEpisodes, from + per - 1);
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// Nome da aba: "1-12", "13-24"… (aba de 1 episódio só: "25").
export function pageLabel(page: number, totalEpisodes: number, per = EPISODES_PER_PAGE): string {
  const eps = pageEpisodes(page, totalEpisodes, per);
  if (!eps.length) return '';
  return eps.length === 1 ? String(eps[0]) : `${eps[0]}-${eps[eps.length - 1]}`;
}

// Aba padrão (sem aba lembrada): a do primeiro episódio ainda não assistido; tudo
// assistido → a primeira.
export function defaultPage(totalEpisodes: number, watched: number[], per = EPISODES_PER_PAGE): number {
  const seen = new Set(watched);
  for (let ep = 1; ep <= totalEpisodes; ep++) if (!seen.has(ep)) return pageOfEpisode(ep, per);
  return 0;
}

// Aba aberta por título+temporada, lembrada entre idas e voltas (player, home, fechar
// o app). Só o índice; não expira.
const KEY = 'watchmov_ep_page';
function readAll(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function loadEpisodePage(tmdbId: number, season: number): number | null {
  const v = readAll()[`${tmdbId}:${season}`];
  return typeof v === 'number' && v >= 0 ? v : null;
}
export function saveEpisodePage(tmdbId: number, season: number, page: number) {
  try {
    const all = readAll();
    all[`${tmdbId}:${season}`] = page;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* cota cheia: só perde a aba lembrada */ }
}
