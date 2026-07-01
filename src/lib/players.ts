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
  // BetterFlix REMOVIDO 01/07: todos os domínios morreram (betterflix.click=404,
  // betterflix.xyz=parking à venda, betterflix.vercel.app=402). Sem domínio vivo.
  {
    id: 'fembed',
    name: 'Fonte 1 (Fembed PT-BR)',
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
    name: 'Fonte 2 (EmbedPlayApi PT-BR)',
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
    name: 'Fonte 3 (SuperFlix PT-BR DUB+LEG)',
    // Player BR clássico com dublado e legendado + seletor de servidores
    // (warezcdn/superflix). Só toca dentro de iframe (acesso direto cai numa
    // página "Acesso Restrito"). Aceita IMDB ou TMDB id. superflixapi.cyou é o
    // host que efetivamente serve o player.
    build: (t) => {
      const id = t.imdbId ?? t.tmdbId;
      if (!id) return null;
      return t.type === 'movie'
        ? `https://superflixapi.cyou/filme/${id}`
        : `https://superflixapi.cyou/serie/${id}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'megaembed',
    name: 'Fonte 4 (MegaEmbed PT-BR)',
    // Player BR. Filme: /embed/{id} — prefere IMDB (catálogo casa melhor; alguns
    // TMDB numéricos de filme não resolvem). Série: /embed/{id}?sea=&epi=.
    build: (t) => {
      if (t.type === 'movie') {
        const id = t.imdbId ?? t.tmdbId;
        if (!id) return null;
        return `https://megaembedapi.site/embed/${id}`;
      }
      const id = t.tmdbId ?? t.imdbId;
      if (!id) return null;
      return `https://megaembedapi.site/embed/${id}?sea=${s(t)}&epi=${e(t)}`;
    },
  },
  {
    id: 'myembed',
    name: 'Fonte 5 (MyEmbed PT-BR)',
    // EmbedMovies/MyEmbed: player BR de alta qualidade. Só toca em iframe.
    // Aceita IMDB ou TMDB id. Filme /filme/{id}; série /serie/{id}/{s}/{e}.
    build: (t) => {
      const id = t.tmdbId ?? t.imdbId;
      if (!id) return null;
      return t.type === 'movie'
        ? `https://myembed.biz/filme/${id}`
        : `https://myembed.biz/serie/${id}/${s(t)}/${e(t)}`;
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
];
