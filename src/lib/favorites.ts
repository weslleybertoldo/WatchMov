// Favoritos (a antiga "Minha Lista"; pedido dele 01/11/2026): aba própria ao lado de Ao Vivo, selo de pastinha na
// capa de quem é favorito e o menu de "segurar" a capa (dedo no celular, OK do controle na TV) pra pôr ou tirar.
// O favorito continua sendo o `favorite` da ficha em wm_items — nada mudou no banco.
import { useSyncExternalStore } from 'react';
import type { MediaSummary, TmdbDetails } from '@/lib/tmdb';
import type { Season, WatchItem } from '@/types/watch';

export type TipoTmdb = 'movie' | 'tv';

export const chaveFavorito = (type: TipoTmdb, tmdbId: number) => `${type}-${tmdbId}`;

// Chaves dos favoritos (tipo-tmdbId), publicadas pelo Index a cada mudança da biblioteca. Cada capa lê só o SEU
// booleano: quando um título entra ou sai, só as capas dele redesenham (importa na TV, com dezenas de capas na tela).
let chaves = new Set<string>();
const ouvintes = new Set<() => void>();

export function publicarFavoritos(novas: Set<string>) {
  if (novas.size === chaves.size && [...novas].every(k => chaves.has(k))) return;   // nada mudou: ninguém acorda
  chaves = novas;
  ouvintes.forEach(f => f());
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}

export function ehFavorito(type: TipoTmdb, tmdbId: number): boolean {
  return chaves.has(chaveFavorito(type, tmdbId));
}

export function useEhFavorito(type: TipoTmdb, tmdbId: number): boolean {
  return useSyncExternalStore(assinar, () => ehFavorito(type, tmdbId));
}

// Chaves a partir da biblioteca: só fichas com título da TMDB e marcadas como favorito.
export function chavesDosFavoritos(items: WatchItem[]): Set<string> {
  const s = new Set<string>();
  for (const i of items) if (i.favorite && i.tmdbId) s.add(chaveFavorito(i.type === 'series' ? 'tv' : 'movie', i.tmdbId));
  return s;
}

// Menu do "segurar": a capa pede, o Index (dono do store) mostra. Um menu só pro app inteiro.
// `continuar`: a capa é do Continuar assistindo — só ali o menu mostra o "Remover da lista" (pedido dele 07/11/2026).
export interface OrigemDoMenu { continuar?: boolean }
let abrirMenu: ((m: MediaSummary, origem: OrigemDoMenu) => void) | null = null;

export function registrarMenuFavorito(f: ((m: MediaSummary, origem: OrigemDoMenu) => void) | null) {
  abrirMenu = f;
}

export function pedirMenuFavorito(m: MediaSummary, origem: OrigemDoMenu = {}): boolean {
  if (!abrirMenu) return false;
  abrirMenu(m, origem);
  return true;
}

// Ficha nova na biblioteca com o que a TMDB devolveu (a mesma do botão de pastinha na página do título).
// Sem os detalhes (TMDB fora do ar) sai com o básico do cartaz; a página do título completa as temporadas depois.
export function fichaDaBiblioteca(media: MediaSummary, details: TmdbDetails | null) {
  const serie = media.type === 'tv';
  const seasons: Season[] | undefined = serie
    ? (details?.seasons || []).map(s => ({
        id: crypto.randomUUID(),   // o mesmo generateId() do store (este arquivo não puxa o Supabase: a capa usa ele)
        number: s.number,
        totalEpisodes: s.totalEpisodes,
        watchedEpisodes: 0,
        episodeDuration: s.episodeDuration,
      }))
    : undefined;
  return {
    tmdbId: media.tmdbId,
    type: (serie ? 'series' : 'movie') as 'movie' | 'series',
    title: details?.title || media.title,
    imdbId: details?.imdbId,
    posterUrl: details?.posterUrl || media.posterUrl,
    synopsis: details?.synopsis,
    genre: details?.genre,
    rating: details?.rating ?? media.rating,
    votes: details?.votes ?? media.votes,
    totalDuration: details?.runtime,
    seasons,
  };
}
