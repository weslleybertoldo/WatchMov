// Integração TMDB — busca de títulos e metadados (capa, sinopse, categoria, IDs).
// Key via VITE_TMDB_API_KEY (v3, grátis em themoviedb.org/settings/api).
// Falha graciosa: se não houver key ou a rede falhar, lança erro tratável pela UI
// (que cai para preenchimento manual).

const API_KEY = import.meta.env.VITE_TMDB_API_KEY as string | undefined;
const BASE = 'https://api.themoviedb.org/3';
const IMG_BASE = 'https://image.tmdb.org/t/p';

export const TMDB_ENABLED = !!API_KEY;

export type TmdbMediaType = 'movie' | 'tv';

export interface TmdbSearchResult {
  tmdbId: number;
  title: string;
  year?: string;
  posterUrl?: string;
  overview?: string;
  rating?: number;
  votes?: number;
  type: TmdbMediaType;
}

export interface TmdbSeasonInfo {
  number: number;
  totalEpisodes: number;
  episodeDuration: number; // minutos
}

export interface TmdbDetails {
  tmdbId: number;
  imdbId?: string;
  title: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string; // categorias separadas por vírgula, ex: "Ação, Aventura"
  rating?: number; // nota 0-10
  votes?: number;  // quantidade de avaliações
  // movie
  runtime?: number; // minutos
  // tv
  seasons?: TmdbSeasonInfo[];
}

function posterUrl(path: string | null | undefined, size = 'w500'): string | undefined {
  return path ? `${IMG_BASE}/${size}${path}` : undefined;
}

function requireKey() {
  if (!API_KEY) {
    throw new Error('TMDB não configurado (VITE_TMDB_API_KEY ausente)');
  }
}

async function tmdbFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  requireKey();
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('api_key', API_KEY as string);
  url.searchParams.set('language', 'pt-BR');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`TMDB ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

interface RawSearchItem {
  id: number;
  title?: string;        // movie
  name?: string;         // tv
  release_date?: string; // movie
  first_air_date?: string; // tv
  poster_path?: string | null;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
}

export async function searchTitle(query: string, type: TmdbMediaType): Promise<TmdbSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await tmdbFetch<{ results: RawSearchItem[] }>(`/search/${type}`, { query: q, include_adult: 'false' });
  return (data.results || []).slice(0, 12).map((r) => {
    const date = r.release_date || r.first_air_date;
    return {
      tmdbId: r.id,
      title: r.title || r.name || 'Sem título',
      year: date ? date.slice(0, 4) : undefined,
      posterUrl: posterUrl(r.poster_path),
      overview: r.overview || undefined,
      rating: r.vote_average || undefined,
      votes: r.vote_count || undefined,
      type,
    };
  });
}

interface RawDetails {
  id: number;
  imdb_id?: string | null;
  title?: string;
  name?: string;
  poster_path?: string | null;
  overview?: string;
  runtime?: number;
  episode_run_time?: number[];
  vote_average?: number;
  vote_count?: number;
  genres?: { id: number; name: string }[];
  external_ids?: { imdb_id?: string | null };
  seasons?: { season_number: number; episode_count: number }[];
}

export async function getDetails(tmdbId: number, type: TmdbMediaType): Promise<TmdbDetails> {
  const d = await tmdbFetch<RawDetails>(`/${type}/${tmdbId}`, { append_to_response: 'external_ids' });
  const genre = (d.genres || []).map((g) => g.name).join(', ') || undefined;
  const imdbId = d.imdb_id || d.external_ids?.imdb_id || undefined;

  const details: TmdbDetails = {
    tmdbId: d.id,
    imdbId: imdbId || undefined,
    title: d.title || d.name || 'Sem título',
    posterUrl: posterUrl(d.poster_path),
    synopsis: d.overview || undefined,
    genre,
    rating: d.vote_average || undefined,
    votes: d.vote_count || undefined,
  };

  if (type === 'movie') {
    details.runtime = d.runtime || undefined;
  } else {
    const epDur = (d.episode_run_time && d.episode_run_time[0]) || 24;
    details.seasons = (d.seasons || [])
      .filter((s) => s.season_number >= 1 && s.episode_count > 0)
      .map((s) => ({
        number: s.season_number,
        totalEpisodes: s.episode_count,
        episodeDuration: epDur,
      }));
  }

  return details;
}
