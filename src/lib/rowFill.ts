// Linhas de gênero da home (filmes/séries/animes) sem título repetido.
//
// Cada título aparece só na linha da sua categoria principal (`isPrimaryGenre`) e a
// linha nunca é completada com título de outra categoria (pedido dele 20/10/2026 —
// antes completava, e Doraemon aparecia em Ação & Aventura e em Família). A página 1
// da TMDB não basta pros gêneros menos comuns (Mistério e Família, em séries, fecham
// 10 só na página 4–5, medido em 20/10/2026): busca até ROW_MAX_PAGES páginas enquanto
// faltam títulos. Linha que nem assim chega a ROW_MIN_SHOW volta vazia e a MediaRow
// não desenha (em animes, Guerra & Política tem 1 título).

export const ROW_MIN = 10;        // a MediaRow mostra 10 cards
export const ROW_MIN_SHOW = 5;    // menos que isso a linha some
export const ROW_MAX_PAGES = 5;

export async function fillRow<T extends { tmdbId: number }>(
  fetchPage: (page: number) => Promise<T[]>,
  keep: (item: T) => boolean,
  min = ROW_MIN,
  maxPages = ROW_MAX_PAGES,
  minShow = ROW_MIN_SHOW,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= maxPages && out.length < min; page++) {
    let items: T[];
    try { items = await fetchPage(page); }
    catch (e) { if (page === 1) throw e; break; }   // página extra falhou: fica com o que tem
    if (!items.length) break;
    for (const m of items) {
      if (seen.has(m.tmdbId) || !keep(m)) continue;
      seen.add(m.tmdbId);
      out.push(m);
    }
  }
  return out.length >= minShow ? out : [];
}

/** O título pertence à linha `genreId` quando esse é o 1º gênero DELE que tem linha
 *  (ordem da TMDB) — ou quando nenhum gênero dele tem linha. */
export function isPrimaryGenre(genreIds: number[] | undefined, genreId: number, rowIds: number[]): boolean {
  const first = (genreIds || []).find(g => rowIds.includes(g));
  return first === undefined || first === genreId;
}
