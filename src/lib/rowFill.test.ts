import { describe, it, expect, vi } from 'vitest';
import { fillRow, isPrimaryGenre } from './rowFill';

type Item = { tmdbId: number; genreIds: number[] };
const item = (tmdbId: number, genreIds: number[]): Item => ({ tmdbId, genreIds });
const ROWS = [28, 12, 14]; // Ação, Aventura, Fantasia

describe('isPrimaryGenre', () => {
  it('1º gênero com linha decide; sem gênero de linha entra onde o discover devolveu', () => {
    expect(isPrimaryGenre([12, 14], 14, ROWS)).toBe(false);  // Aventura vem antes
    expect(isPrimaryGenre([14, 12], 14, ROWS)).toBe(true);
    expect(isPrimaryGenre([99], 14, ROWS)).toBe(true);
    expect(isPrimaryGenre(undefined, 14, ROWS)).toBe(true);
  });
});

describe('fillRow', () => {
  const keep = (m: Item) => isPrimaryGenre(m.genreIds, 14, ROWS);

  it('linha que fecha na página 1 não busca mais e não muda', async () => {
    const page1 = Array.from({ length: 12 }, (_, i) => item(i + 1, [14]));
    const fetchPage = vi.fn(async () => page1);
    const out = await fillRow(fetchPage, keep);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(out).toEqual(page1);
  });

  it('linha curta busca as páginas seguintes até fechar 10 primários', async () => {
    const pages: Record<number, Item[]> = {
      1: [item(1, [14]), item(2, [12, 14]), item(3, [12, 14])],
      2: Array.from({ length: 6 }, (_, i) => item(10 + i, [14])),
      3: Array.from({ length: 5 }, (_, i) => item(20 + i, [14])),
    };
    const fetchPage = vi.fn(async (p: number) => pages[p] ?? []);
    const out = await fillRow(fetchPage, keep);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(out.map(m => m.tmdbId)).toEqual([1, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24]);
  });

  it('não fechou nem em 3 páginas: completa com os extras (primários primeiro)', async () => {
    const fetchPage = vi.fn(async (p: number) => p === 1
      ? [item(1, [14]), item(2, [12, 14]), item(3, [28, 14])]
      : []);
    const out = await fillRow(fetchPage, keep);
    expect(fetchPage).toHaveBeenCalledTimes(2);        // página 2 vazia encerra a busca
    expect(out.map(m => m.tmdbId)).toEqual([1, 2, 3]);
  });

  it('repetido entre páginas entra 1x; falha em página extra não derruba a linha', async () => {
    const fetchPage = vi.fn(async (p: number) => {
      if (p === 1) return [item(1, [14]), item(2, [14])];
      if (p === 2) return [item(2, [14]), item(3, [12, 14])];
      throw new Error('TMDB 500');
    });
    const out = await fillRow(fetchPage, keep);
    expect(out.map(m => m.tmdbId)).toEqual([1, 2, 3]);
  });

  it('falha na página 1 propaga (a MediaRow trata)', async () => {
    await expect(fillRow<Item>(async () => { throw new Error('TMDB 401'); }, keep)).rejects.toThrow('TMDB 401');
  });
});
