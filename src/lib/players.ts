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
    // source=source3 = "Servidor 3" (default que toca bem). SEM singleSource pra o
    // seletor de Servidor (1-5) do BetterFlix ficar disponível e o próprio player
    // lembrar a escolha (storage do iframe; não dá pra ler de fora, cross-origin).
    build: (t) => {
      if (!t.tmdbId) return null;
      const base = t.type === 'movie'
        ? `https://betterflix.click/api/player?id=${t.tmdbId}&type=movie`
        : `https://betterflix.click/api/player?id=${t.tmdbId}&type=tv&season=${s(t)}&episode=${e(t)}`;
      return `${base}&source=source3`;
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
    name: 'Fonte 4 (VidAPI — legendado PT)',
    // VidAPI/vaplayer.ru: NÃO dubla (não tem param de áudio). Áudio original +
    // legenda PT-BR auto-carregada do OpenSubtitles. ds_lang/sub_lang=pob =
    // Português (Brasil) no padrão OpenSubtitles (3 letras). Filme exige IMDB id;
    // série usa TMDB id. Serve de fallback quando as fontes dubladas falham.
    build: (t) => {
      // ds_lang=pob = auto-busca legenda em Português-BR no OpenSubtitles
      // (código 3 letras do OpenSubtitles; pob = pt-BR, por = pt-PT).
      const q = 'ds_lang=pob&sub_default=true';
      // Filme aceita IMDB ou TMDB id; prefere IMDB (catálogo casa melhor).
      if (t.type === 'movie') {
        const id = t.imdbId ?? t.tmdbId;
        if (!id) return null;
        return `https://vaplayer.ru/embed/movie/${id}?${q}`;
      }
      const id = t.imdbId ?? t.tmdbId;
      if (!id) return null;
      return `https://vaplayer.ru/embed/tv/${id}/${s(t)}/${e(t)}?${q}`;
    },
  },
];

// Domínios usados (para CSP frame-src)
export const PROVIDER_HOSTS = [
  'https://betterflix.click',
  'https://fembed.sx',
  'https://embedplayapi.top',
  'https://vaplayer.ru',
];
