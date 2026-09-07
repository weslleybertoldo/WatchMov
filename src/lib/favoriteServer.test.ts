import { describe, it, expect, beforeEach } from 'vitest';
import {
  pickDefaultServer, loadFavoriteServer, saveFavoriteServer, effectiveFavoriteServer,
  serverLabel, FAVORITE_SERVER_KEY, DEFAULT_SERVER_ID,
} from './favoriteServer';
import { PROVIDERS } from './players';

const ALL = PROVIDERS.map(p => ({ id: p.id }));

describe('pickDefaultServer — fonte padrão do Assistir', () => {
  it('sem favorito abre a Fonte 6 (EmbedMovies), o padrão antigo', () => {
    expect(pickDefaultServer(ALL, null)).toBe('embedmovies');
  });
  it('favorito marcado vira o padrão quando existe pro título', () => {
    expect(pickDefaultServer(ALL, 'superflix')).toBe('superflix');
    expect(pickDefaultServer(ALL, 'embedplayapi')).toBe('embedplayapi');
  });
  it('favorito que não monta URL pro título cai na Fonte 6', () => {
    const semFshd = ALL.filter(p => p.id !== 'fshd');   // fshd exige imdbId
    expect(pickDefaultServer(semFshd, 'fshd')).toBe('embedmovies');
  });
  it('sem Fonte 6 cai na SuperFlix; sem as duas, na 1ª disponível', () => {
    const semEmbed = ALL.filter(p => p.id !== 'embedmovies');
    expect(pickDefaultServer(semEmbed, null)).toBe('superflix');
    expect(pickDefaultServer([{ id: 'fembed' }, { id: 'warezcdn' }], 'xyz')).toBe('fembed');
    expect(pickDefaultServer([], 'superflix')).toBeUndefined();
  });
});

describe('favorito em localStorage', () => {
  beforeEach(() => localStorage.clear());
  it('sem registro: efetivo = padrão', () => {
    expect(loadFavoriteServer()).toBeNull();
    expect(effectiveFavoriteServer()).toBe(DEFAULT_SERVER_ID);
  });
  it('salvar grava a chave e passa a ser o efetivo', () => {
    saveFavoriteServer('superflix');
    expect(localStorage.getItem(FAVORITE_SERVER_KEY)).toBe('superflix');
    expect(loadFavoriteServer()).toBe('superflix');
    expect(effectiveFavoriteServer()).toBe('superflix');
  });
  it('salvar dispara o evento que a aba escuta', () => {
    let got: string | null = null;
    window.addEventListener('watchmov:fav-server', (e) => { got = (e as CustomEvent<string>).detail; });
    saveFavoriteServer('fembed');
    expect(got).toBe('fembed');
  });
});

describe('serverLabel — nome curto do popup', () => {
  it('"Fonte 6 (EmbedMovies PT-BR)" vira "Fonte 6 (EmbedMovies)"', () => {
    const p = PROVIDERS.find(x => x.id === 'embedmovies')!;
    expect(serverLabel(p)).toBe('Fonte 6 (EmbedMovies)');
  });
  it('todas as fontes têm rótulo "Fonte N (tag)"', () => {
    for (const p of PROVIDERS) expect(serverLabel(p)).toMatch(/^Fonte \d+ \(.+\)$/);
  });
});
