// Linhas de gênero da home (filmes/séries/animes) com tamanho garantido.
//
// A regra "cada título só na linha do seu gênero predominante" (pra não repetir
// Superman em Ação+Aventura+Ficção) deixava linhas quase vazias na página 1 da TMDB:
// Fantasia (filmes) ficava com 2 cards, Família/Mistério (séries) com 2–3, Aventura e
// Romance com 6 (medido em 07/09/2026 com a chave do app). Aqui: busca até
// ROW_MAX_PAGES páginas enquanto faltam títulos "primários" e, se mesmo assim não fecha
// ROW_MIN, completa com os títulos do gênero que também moram em outra linha — repetir
// um card é melhor que uma linha com 2. Linhas que já fecham na página 1 não mudam.

export const ROW_MIN = 10;        // a MediaRow mostra 10 cards
export const ROW_MAX_PAGES = 3;

export async function fillRow<T extends { tmdbId: number }>(
  fetchPage: (page: number) => Promise<T[]>,
  keep: (item: T) => boolean,
  min = ROW_MIN,
  maxPages = ROW_MAX_PAGES,
): Promise<T[]> {
  const primary: T[] = [];
  const extra: T[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= maxPages && primary.length < min; page++) {
    let items: T[];
    try { items = await fetchPage(page); }
    catch (e) { if (page === 1) throw e; break; }   // página extra falhou: fica com o que tem
    if (!items.length) break;
    for (const m of items) {
      if (seen.has(m.tmdbId)) continue;
      seen.add(m.tmdbId);
      (keep(m) ? primary : extra).push(m);
    }
  }
  return primary.length >= min ? primary : [...primary, ...extra];
}

/** O título pertence à linha `genreId` quando esse é o 1º gênero DELE que tem linha
 *  (ordem da TMDB) — ou quando nenhum gênero dele tem linha. */
export function isPrimaryGenre(genreIds: number[] | undefined, genreId: number, rowIds: number[]): boolean {
  const first = (genreIds || []).find(g => rowIds.includes(g));
  return first === undefined || first === genreId;
}
