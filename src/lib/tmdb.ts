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

function backdropUrl(path: string | null | undefined, size = 'w780'): string | undefined {
  return path ? `${IMG_BASE}/${size}${path}` : undefined;
}

// ── Catálogo (browse estilo Netflix) ──

export interface MediaSummary {
  tmdbId: number;
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: number;
  votes?: number;
  year?: string;
  type: TmdbMediaType;
}

// Gêneros curados para as linhas (id TMDB + rótulo PT-BR)
export const MOVIE_GENRES: { id: number; name: string }[] = [
  { id: 28, name: 'Ação' },
  { id: 12, name: 'Aventura' },
  { id: 878, name: 'Ficção científica' },
  { id: 35, name: 'Comédia' },
  { id: 27, name: 'Terror' },
  { id: 18, name: 'Drama' },
  { id: 16, name: 'Animação' },
  { id: 10749, name: 'Romance' },
  { id: 80, name: 'Crime' },
  { id: 14, name: 'Fantasia' },
];

export const TV_GENRES: { id: number; name: string }[] = [
  { id: 10759, name: 'Ação & Aventura' },
  { id: 10765, name: 'Ficção & Fantasia' },
  { id: 35, name: 'Comédia' },
  { id: 18, name: 'Drama' },
  { id: 16, name: 'Animação' },
  { id: 80, name: 'Crime' },
  { id: 9648, name: 'Mistério' },
  { id: 10751, name: 'Família' },
];

interface RawListItem {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
}

function toSummary(r: RawListItem, type: TmdbMediaType): MediaSummary {
  const date = r.release_date || r.first_air_date;
  return {
    tmdbId: r.id,
    title: r.title || r.name || 'Sem título',
    posterUrl: posterUrl(r.poster_path, 'w342'),
    backdropUrl: backdropUrl(r.backdrop_path),
    rating: r.vote_average || undefined,
    votes: r.vote_count || undefined,
    year: date ? date.slice(0, 4) : undefined,
    type,
  };
}

function dedupeWithPoster(items: MediaSummary[]): MediaSummary[] {
  const seen = new Set<number>();
  return items.filter(m => {
    if (!m.posterUrl || seen.has(m.tmdbId)) return false;
    seen.add(m.tmdbId);
    return true;
  });
}

// Top 10 da semana (mais "assistidos"/em alta)
export async function trendingWeek(type: TmdbMediaType): Promise<MediaSummary[]> {
  const d = await tmdbFetch<{ results: RawListItem[] }>(`/trending/${type}/week`);
  return dedupeWithPoster((d.results || []).map(r => toSummary(r, type))).slice(0, 10);
}

// Recentes: filmes em cartaz / séries no ar
export async function recent(type: TmdbMediaType): Promise<MediaSummary[]> {
  const path = type === 'movie' ? '/movie/now_playing' : '/tv/on_the_air';
  const d = await tmdbFetch<{ results: RawListItem[] }>(path, { region: 'BR', page: '1' });
  return dedupeWithPoster((d.results || []).map(r => toSummary(r, type)));
}

// Mais relevantes por categoria
export async function discoverByGenre(type: TmdbMediaType, genreId: number, page = 1): Promise<MediaSummary[]> {
  const d = await tmdbFetch<{ results: RawListItem[] }>(`/discover/${type}`, {
    with_genres: String(genreId),
    sort_by: 'popularity.desc',
    'vote_count.gte': '200',
    include_adult: 'false',
    watch_region: 'BR',
    page: String(page),
  });
  return dedupeWithPoster((d.results || []).map(r => toSummary(r, type)));
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

// Busca combinada filme + série → MediaSummary[]
export async function searchMulti(query: string): Promise<MediaSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const [movies, tvs] = await Promise.all([
    tmdbFetch<{ results: RawListItem[] }>(`/search/movie`, { query: q, include_adult: 'false' }),
    tmdbFetch<{ results: RawListItem[] }>(`/search/tv`, { query: q, include_adult: 'false' }),
  ]);
  const merged = [
    ...(movies.results || []).map(r => toSummary(r, 'movie')),
    ...(tvs.results || []).map(r => toSummary(r, 'tv')),
  ];
  // ordena por relevância aproximada (votos) e remove sem capa
  return dedupeWithPoster(merged).sort((a, b) => (b.votes || 0) - (a.votes || 0));
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
