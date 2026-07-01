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

// Ordem definida pelo Weslley 01/07: EmbedPlayApi é a PRINCIPAL (PROVIDERS[0] = default).
// (BetterFlix/VidAPI/WarezCDN removidos — domínios mortos/propaganda.)
export const PROVIDERS: Provider[] = [
  {
    id: 'embedplayapi',
    name: 'Fonte 1 (EmbedPlayApi PT-BR)', // PRINCIPAL/default
    // Player BR dublado. TMDB id.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://embedplayapi.top/embed/${t.tmdbId}`
        : `https://embedplayapi.top/embed/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'superflix',
    name: 'Fonte 2 (SuperFlix PT-BR DUB+LEG)',
    // Dublado+legendado. Anti-bot no CDN → NÃO toca no player nativo; abre no
    // modo Servidor (iframe/WebView). Aceita IMDB ou TMDB id.
    build: (t) => {
      const id = t.imdbId ?? t.tmdbId;
      if (!id) return null;
      return t.type === 'movie'
        ? `https://superflixapi.cyou/filme/${id}`
        : `https://superflixapi.cyou/serie/${id}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'fembed',
    name: 'Fonte 3 (Fembed PT-BR)',
    // Herdeiro do Superflix, catálogo dublado pt-br. TMDB id.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://fembed.sx/e/${t.tmdbId}`
        : `https://fembed.sx/e/${t.tmdbId}/${s(t)}-${e(t)}`;
    },
  },
  {
    id: 'megaembed',
    name: 'Fonte 4 (MegaEmbed — só séries)',
    // ⚠️ 01/07: endpoint de FILME quebrado ("movie not found" p/ qualquer id) —
    // só SÉRIE funciona (/embed/{tmdb}?sea=&epi=). Filme retorna null (some da lista).
    build: (t) => {
      if (t.type === 'movie') return null;
      const id = t.tmdbId ?? t.imdbId;
      if (!id) return null;
      return `https://megaembedapi.site/embed/${id}?sea=${s(t)}&epi=${e(t)}`;
    },
  },
  {
    id: 'myembed',
    name: 'Fonte 5 (MyEmbed PT-BR)',
    // EmbedMovies/MyEmbed: player BR. Aceita IMDB ou TMDB id.
    build: (t) => {
      const id = t.tmdbId ?? t.imdbId;
      if (!id) return null;
      return t.type === 'movie'
        ? `https://myembed.biz/filme/${id}`
        : `https://myembed.biz/serie/${id}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'playerflix',
    name: 'Fonte 6 (PlayerFlix — via servidor)',
    // Só toca embedado (anti-hotlink) → abre no modo Servidor (iframe), não no
    // player nativo. Resolve TMDB id. /filme/{tmdb}; /serie/{tmdb}/{s}/{e}.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://playerflixapi.com/filme/${t.tmdbId}`
        : `https://playerflixapi.com/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
];

// Domínios usados (para CSP frame-src)
export const PROVIDER_HOSTS = [
  'https://fembed.sx',
  'https://embedplayapi.top',
  'https://superflixapi.cyou',
  'https://megaembedapi.site',
  'https://myembed.biz',
  'https://playerflixapi.com',
];
