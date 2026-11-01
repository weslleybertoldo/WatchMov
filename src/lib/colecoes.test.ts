import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TmdbCollection } from './tmdb';

vi.mock('./tmdb', () => ({ getCollection: vi.fn() }));

// Cada teste pega o módulo novo (o cache das coleções é do módulo).
async function modulo() {
  vi.resetModules();
  const tmdb = await import('./tmdb');
  const col = await import('./colecoes');
  return { getCollection: vi.mocked(tmdb.getCollection), ...col };
}

const colecao = (id: number, n = 3): TmdbCollection => ({
  id, name: `Coleção ${id}`,
  parts: Array.from({ length: n }, (_, i) => ({ tmdbId: id * 10 + i, title: `Filme ${i + 1}`, type: 'movie' as const })),
});

describe('COLECOES — a lista curada da fileira', () => {
  it('IDs únicos, nomes preenchidos e as 10 primeiras na fileira', async () => {
    const { COLECOES, COLECOES_NA_FILEIRA } = await modulo();
    const ids = COLECOES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COLECOES.every(c => c.id > 0 && c.nome.trim().length > 0)).toBe(true);
    expect(COLECOES_NA_FILEIRA).toBe(10);
    expect(COLECOES.length).toBeGreaterThan(COLECOES_NA_FILEIRA);   // o resto vai pro "Ver tudo"
    expect(ids.slice(0, 3)).toEqual([86311, 1241, 119]);              // Vingadores, Harry Potter, Senhor dos Anéis
  });
});

describe('carregarColecao() — uma consulta à TMDB por coleção', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a 2ª abertura usa o cache (e a pronta aparece na hora)', async () => {
    const { getCollection, carregarColecao, colecaoPronta } = await modulo();
    getCollection.mockResolvedValue(colecao(1241));
    expect(colecaoPronta(1241)).toBeUndefined();
    await carregarColecao(1241);
    await carregarColecao(1241);
    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(colecaoPronta(1241)?.name).toBe('Coleção 1241');
  });

  it('falhou (rede): a próxima abertura tenta de novo', async () => {
    const { getCollection, carregarColecao } = await modulo();
    getCollection.mockRejectedValueOnce(new Error('TMDB 500')).mockResolvedValueOnce(colecao(10));
    await expect(carregarColecao(10)).rejects.toThrow('TMDB 500');
    await expect(carregarColecao(10)).resolves.toMatchObject({ id: 10 });
    expect(getCollection).toHaveBeenCalledTimes(2);
  });
});

describe('carregarColecoes() — fileira e "Ver tudo"', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mantém a ordem pedida, pula a que falhou e a que veio sem filme', async () => {
    const { getCollection, carregarColecoes, colecoesProntas } = await modulo();
    getCollection.mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('TMDB 404');
      return colecao(id, id === 3 ? 0 : 2);
    });
    const l = await carregarColecoes([5, 2, 3, 1, 4], 2);
    expect(l.map(c => c.id)).toEqual([5, 1, 4]);
    expect(colecoesProntas([5, 1, 4])?.map(c => c.id)).toEqual([5, 1, 4]);
    expect(colecoesProntas([5, 2])).toBeUndefined();   // a que falhou não está pronta: a tela carrega de novo
  });

  it('de lote em lote (a Fire TV tem pouca memória)', async () => {
    const { getCollection, carregarColecoes } = await modulo();
    let abertas = 0, pico = 0;
    getCollection.mockImplementation(async (id: number) => {
      abertas++; pico = Math.max(pico, abertas);
      await new Promise(r => setTimeout(r, 5));
      abertas--;
      return colecao(id);
    });
    await carregarColecoes(Array.from({ length: 20 }, (_, i) => i + 1), 8);
    expect(pico).toBeLessThanOrEqual(8);
    expect(getCollection).toHaveBeenCalledTimes(20);
  });
});

describe('anosDaColecao() e filmesLabel()', () => {
  it('do 1º ao último lançado; anúncio futuro não estica; um ano só', async () => {
    const { anosDaColecao } = await modulo();
    const p = (date?: string) => ({ tmdbId: 1, title: 'x', type: 'movie' as const, date, year: date?.slice(0, 4) });
    expect(anosDaColecao({ parts: [p('2012-04-25'), p('2019-04-24'), p('2026-12-16'), p()] }, '2026-11-01')).toBe('2012–2019');
    expect(anosDaColecao({ parts: [p('2027-06-30')] }, '2026-11-01')).toBe('2027');
    expect(anosDaColecao({ parts: [p('2010-01-01'), p('2010-06-01')] }, '2026-11-01')).toBe('2010');
    expect(anosDaColecao({ parts: [p()] }, '2026-11-01')).toBe('');
  });

  it('"1 filme" / "8 filmes"', async () => {
    const { filmesLabel } = await modulo();
    expect(filmesLabel(1)).toBe('1 filme');
    expect(filmesLabel(8)).toBe('8 filmes');
  });
});
