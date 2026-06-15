// Provedores de embed (opção A: multi-fonte). Cada um devolve uma URL de iframe
// por tmdb/imdb id. Idioma do áudio NÃO é detectável por API — o usuário troca
// a fonte; alguns provedores têm faixa dublada PT no seletor interno do player
// pra títulos populares. Multi-fonte serve principalmente de fallback/resiliência.

export interface PlayerTarget {
  tmdbId?: number;
  imdbId?: string;
  type: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export interface Provider {
  id: string;
  name: string;
  build: (t: PlayerTarget) => string | null;
}

const s = (t: PlayerTarget) => t.season ?? 1;
const e = (t: PlayerTarget) => t.episode ?? 1;

export const PROVIDERS: Provider[] = [
  {
    id: 'betterflix',
    name: 'Fonte 1 (BetterFlix PT-BR)',
    // Servidor BR com catálogo dublado pt-br. Só toca dentro de iframe (acesso
    // direto à URL é bloqueado pelo provedor). Aceita só TMDB id.
    // source=source3 = "Servidor 3" (o que toca bem; server2 Premium não abre);
    // singleSource=true trava nessa fonte e esconde o seletor interno.
    build: (t) => {
      if (!t.tmdbId) return null;
      const base = t.type === 'movie'
        ? `https://betterflix.click/api/player?id=${t.tmdbId}&type=movie`
        : `https://betterflix.click/api/player?id=${t.tmdbId}&type=tv&season=${s(t)}&episode=${e(t)}`;
      return `${base}&source=source3&singleSource=true`;
    },
  },
  {
    id: 'fembed',
    name: 'Fonte 2 (Fembed PT-BR)',
    // Herdeiro do Superflix, catálogo dublado pt-br. TMDB id.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://fembed.sx/e/${t.tmdbId}`
        : `https://fembed.sx/e/${t.tmdbId}/${s(t)}-${e(t)}`;
    },
  },
  {
    id: 'embedplayapi',
    name: 'Fonte 3 (EmbedPlayApi PT-BR)',
    // Player BR dublado. TMDB id.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://embedplayapi.top/embed/${t.tmdbId}`
        : `https://embedplayapi.top/embed/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'vidapi',
    name: 'Fonte 4 (VidAPI)',
    build: (t) => {
      const id = t.imdbId || (t.tmdbId ? String(t.tmdbId) : null);
      if (!id) return null;
      const base = t.type === 'movie' ? `movie/${id}` : `tv/${id}/${s(t)}/${e(t)}`;
      return `https://vaplayer.ru/embed/${base}?autoplay=1&ds_lang=pt&sub_lang=pt`;
    },
  },
  {
    id: 'vidsrc',
    name: 'Fonte 5 (VidSrc)',
    build: (t) => {
      const id = t.imdbId || (t.tmdbId ? String(t.tmdbId) : null);
      if (!id) return null;
      return t.type === 'movie'
        ? `https://vidsrc.xyz/embed/movie/${id}`
        : `https://vidsrc.xyz/embed/tv/${id}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'vidlink',
    name: 'Fonte 6 (VidLink)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://vidlink.pro/movie/${t.tmdbId}`
        : `https://vidlink.pro/tv/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'embedsu',
    name: 'Fonte 7 (Embed.su)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://embed.su/embed/movie/${t.tmdbId}`
        : `https://embed.su/embed/tv/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: '2embed',
    name: 'Fonte 8 (2Embed)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://www.2embed.cc/embed/${t.tmdbId}`
        : `https://www.2embed.cc/embedtv/${t.tmdbId}&s=${s(t)}&e=${e(t)}`;
    },
  },
  {
    id: 'superembed',
    name: 'Fonte 9 (SuperEmbed)',
    build: (t) => {
      if (!t.tmdbId && !t.imdbId) return null;
      const idPart = t.tmdbId ? `video_id=${t.tmdbId}&tmdb=1` : `video_id=${t.imdbId}`;
      const ep = t.type === 'tv' ? `&s=${s(t)}&e=${e(t)}` : '';
      return `https://multiembed.mov/?${idPart}${ep}`;
    },
  },
];

// Domínios usados (para CSP frame-src)
export const PROVIDER_HOSTS = [
  'https://betterflix.click',
  'https://fembed.sx',
  'https://embedplayapi.top',
  'https://vaplayer.ru',
  'https://vidsrc.xyz',
  'https://vidlink.pro',
  'https://embed.su',
  'https://www.2embed.cc',
  'https://multiembed.mov',
];
