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

describe('a lista curada — universos, gêneros e destaques', () => {
  it('IDs únicos em tudo (uma saga mora num lugar só) e nomes preenchidos', async () => {
    const { UNIVERSOS, SECOES } = await modulo();
    const todas = [...UNIVERSOS.flatMap(u => u.colecoes), ...SECOES.flatMap(s => s.colecoes)];
    const ids = todas.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(todas.every(c => c.id > 0 && c.nome.trim().length > 0)).toBe(true);
    expect(ids.length).toBeGreaterThan(200);   // pedido dele: "tem muito mais coleção" (eram 32)
    expect(SECOES.every(s => s.colecoes.length > 0 && s.nome.trim().length > 0)).toBe(true);
    expect(new Set(SECOES.map(s => s.chave)).size).toBe(SECOES.length);
  });

  it('Marvel e DC são pastas de pastas: as sagas deles não ficam mais soltas', async () => {
    const { UNIVERSOS, SECOES, universoPorId } = await modulo();
    expect(UNIVERSOS.map(u => [u.id, u.nome])).toEqual([['marvel', 'Marvel'], ['dc', 'DC']]);
    const marvel = universoPorId('marvel')!.colecoes.map(c => c.id);
    const dc = universoPorId('dc')!.colecoes.map(c => c.id);
    // Vingadores, Homem de Ferro, Capitão América, Thor, Guardiões, Homem-Aranha (MCU), X-Men, Deadpool
    expect(marvel).toEqual(expect.arrayContaining([86311, 131292, 131295, 131296, 284433, 531241, 748, 448150]));
    expect(marvel[0]).toBe(86311);
    // os três Batman (Nolan, Matt Reeves, 1989–1997), Superman, Mulher-Maravilha, Coringa
    expect(dc).toEqual(expect.arrayContaining([263, 948485, 120794, 8537, 468552, 987044]));
    const soltas = new Set(SECOES.flatMap(s => s.colecoes.map(c => c.id)));
    expect([...marvel, ...dc].filter(id => soltas.has(id))).toEqual([]);
  });

  it('destaques da fileira: 10 sagas que existem nos gêneros, com Jogos Vorazes e Maze Runner (ele citou)', async () => {
    const { DESTAQUES, SECOES } = await modulo();
    const soltas = new Set(SECOES.flatMap(s => s.colecoes.map(c => c.id)));
    expect(DESTAQUES).toHaveLength(10);
    expect(new Set(DESTAQUES).size).toBe(10);
    expect(DESTAQUES.every(id => soltas.has(id))).toBe(true);
    expect(DESTAQUES).toEqual(expect.arrayContaining([131635, 295130]));
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

  it('nome fixo vence o da TMDB (três "Batman" na TMDB viram nomes diferentes na tela)', async () => {
    const { getCollection, carregarColecao, colecaoPronta } = await modulo();
    getCollection.mockImplementation(async (id: number) => ({ ...colecao(id), name: 'Batman' }));
    expect((await carregarColecao(948485)).name).toBe('The Batman');
    expect((await carregarColecao(120794)).name).toBe('Batman (1989–1997)');
    expect(colecaoPronta(948485)?.name).toBe('The Batman');
    expect((await carregarColecao(1241)).name).toBe('Batman');   // sem nome fixo: fica o da TMDB
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

  it('aoLote: a tela recebe a lista parcial a cada lote (menos no último, que é o resultado)', async () => {
    const { getCollection, carregarColecoes } = await modulo();
    getCollection.mockImplementation(async (id: number) => {
      if (id === 3) throw new Error('TMDB 404');
      return colecao(id);
    });
    const parciais: number[][] = [];
    const l = await carregarColecoes([1, 2, 3, 4, 5], 2, p => parciais.push(p.map(c => c.id)));
    expect(parciais).toEqual([[1, 2], [1, 2, 4]]);
    expect(l.map(c => c.id)).toEqual([1, 2, 4, 5]);
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

  it('"1 filme" / "8 filmes" e "1 coleção" / "21 coleções"', async () => {
    const { filmesLabel, colecoesLabel } = await modulo();
    expect(filmesLabel(1)).toBe('1 filme');
    expect(filmesLabel(8)).toBe('8 filmes');
    expect(colecoesLabel(1)).toBe('1 coleção');
    expect(colecoesLabel(21)).toBe('21 coleções');
  });
});
