import { describe, expect, it } from 'vitest';
import { rotuloDaFonte } from './players';

describe('rotuloDaFonte', () => {
  it('número da fonte, etiqueta e o player escolhido', () => {
    expect(rotuloDaFonte('embedmovies', 'Blogger')).toBe('1 · EmbedMovies · Blogger');
    expect(rotuloDaFonte('superflix', '  Player   2 ')).toBe('4 · SuperFlix · Player 2');
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
