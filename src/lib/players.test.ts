import { describe, expect, it } from 'vitest';
import { rotuloDaFonte } from './players';

describe('rotuloDaFonte', () => {
  it('número da fonte, etiqueta e o player escolhido', () => {
    expect(rotuloDaFonte('embedmovies', 'Blogger')).toBe('1 · EmbedMovies · Blogger');
    expect(rotuloDaFonte('superflix', '  Player   2 ')).toBe('5 · SuperFlix · Player 2');   // 19/10/2026: a Pomfy entrou como 4
    expect(rotuloDaFonte('megaembed', 'Opção 3')).toBe('7 · MegaEmbed · Opção 3');   // 20/10/2026: volta como 7
  });

  it('sem player escolhido fica só o servidor', () => {
    expect(rotuloDaFonte('embedmovies')).toBe('1 · EmbedMovies');
    expect(rotuloDaFonte('embedmovies', '')).toBe('1 · EmbedMovies');
  });

  it('servidor desconhecido não inventa nada', () => {
    expect(rotuloDaFonte('naoexiste', 'Blogger')).toBe('Blogger');
    expect(rotuloDaFonte(undefined, undefined)).toBe('');
  });
});
