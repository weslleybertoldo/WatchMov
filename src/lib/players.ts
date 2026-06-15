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
];

// Domínios usados (para CSP frame-src)
export const PROVIDER_HOSTS = [
  'https://betterflix.click',
  'https://fembed.sx',
  'https://embedplayapi.top',
];
