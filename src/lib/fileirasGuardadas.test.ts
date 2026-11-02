import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  FRESCA_MS, MAX_GUARDADOS, VALIDA_MS, guardarFileira, lerFileira, marcarParaAtualizar, pegarParaAtualizar,
} from './fileirasGuardadas';
import type { MediaSummary } from './tmdb';

const filme = (id: number): MediaSummary => ({
  tmdbId: id, title: `Filme ${id}`, type: 'movie', posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
  date: '2026-10-01', year: '2026', genreIds: [28, 12],
});

// W1 do raio-x (02/11/2026): fileiras da TMDB guardadas no aparelho pra próxima abertura aparecer na hora.
describe('fileiras guardadas', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('guarda só os 10 primeiros, sem os gêneros, e devolve como fresca', () => {
    const t0 = Date.UTC(2026, 10, 2, 3, 0);
    guardarFileira('top10-movie', Array.from({ length: 14 }, (_, i) => filme(i + 1)), t0);
    const lida = lerFileira('top10-movie', t0 + 60_000);
    expect(lida?.fresca).toBe(true);
    expect(lida?.itens).toHaveLength(MAX_GUARDADOS);
    expect(lida?.itens[0]).toEqual({ tmdbId: 1, title: 'Filme 1', type: 'movie', posterUrl: 'https://image.tmdb.org/t/p/w342/1.jpg', date: '2026-10-01', year: '2026' });
    expect(lida?.itens[0]).not.toHaveProperty('genreIds');
  });

  it('passou de 6 h: ainda aparece, mas como velha (atualizar no ocioso)', () => {
    const t0 = Date.UTC(2026, 10, 2, 3, 0);
    guardarFileira('m-28', [filme(1)], t0);
    expect(lerFileira('m-28', t0 + FRESCA_MS - 1)?.fresca).toBe(true);
    expect(lerFileira('m-28', t0 + FRESCA_MS)?.fresca).toBe(false);
    expect(lerFileira('m-28', t0 + VALIDA_MS)?.fresca).toBe(false);
  });

  it('velha demais, relógio voltado, vazia ou estragada: nada (busca na TMDB como sempre)', () => {
    const t0 = Date.UTC(2026, 10, 2, 3, 0);
    guardarFileira('m-28', [filme(1)], t0);
    expect(lerFileira('m-28', t0 + VALIDA_MS + 1)).toBeNull();
    expect(lerFileira('m-28', t0 - 1)).toBeNull();
    expect(lerFileira('nao-existe', t0)).toBeNull();
    localStorage.setItem('wm_fileira:quebrada', '{não é json');
    expect(lerFileira('quebrada', t0)).toBeNull();
    localStorage.setItem('wm_fileira:sem-itens', JSON.stringify({ itens: [], em: t0 }));
    expect(lerFileira('sem-itens', t0)).toBeNull();
  });

  it('lista vazia não apaga o que estava guardado', () => {
    const t0 = Date.UTC(2026, 10, 2, 3, 0);
    guardarFileira('hero', [filme(1)], t0);
    guardarFileira('hero', [], t0 + 1000);
    expect(lerFileira('hero', t0 + 2000)?.itens).toHaveLength(1);
  });

  it('sem espaço no aparelho: segue sem guardar (não quebra a tela)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => guardarFileira('hero', [filme(1)])).not.toThrow();
  });

  it('cada fileira velha pede a TMDB uma vez só por abertura', () => {
    expect(pegarParaAtualizar('top10-tv')).toBe(false);
    marcarParaAtualizar('top10-tv');
    expect(pegarParaAtualizar('top10-tv')).toBe(true);
    expect(pegarParaAtualizar('top10-tv')).toBe(false);   // a outra aba que monta a mesma fileira não repete
  });
});
