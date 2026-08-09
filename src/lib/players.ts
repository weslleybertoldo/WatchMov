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
    // Player BR dublado. TMDB id. Formato /embed/{id} e /embed/{id}/{s}/{e}.
    // ⚠️ o banner "Novo domínio da API, atualize no seu código >> embedplayapi.top"
    // é só ANÚNCIO — NÃO trocar pra /embed/movie|tv (essas rotas devolvem shell
    // vazio "não encontrado"; só o formato abaixo tem o player/servers).
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
  // ── Candidatos BR (esquema validado com o Weslley 09/08 no navegador) ──────────
  // Removidas 09/08: MegaEmbed, PlayerFlix, OverflixTV (overflix.party é slug, sem
  // rota por id), Roxano (domínio morto), MostraFlix (domínio morto), VisionCine
  // (visioncine.lol é slug .html, sem rota por id). Slug-based precisaria de um
  // resolvedor título→slug (scrape) — fora de escopo por ora.
  {
    id: 'warezcdn',
    name: 'Fonte 4 (WarezCDN PT-BR)',
    // Domínio real warezcdn.lat (embed.warezcdn.com morreu). Usa TMDB id
    // (/serie/276643 confirmado). Série abre no landing p/ escolher temporada/ep.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://warezcdn.lat/filme/${t.tmdbId}`
        : `https://warezcdn.lat/serie/${t.tmdbId}`;
    },
  },
  {
    id: 'fshd',
    name: 'Fonte 5 (FS/HD PT-BR)',
    // IMDB id — confirmado no navegador (fshd.link/filme/tt1375666).
    build: (t) => {
      if (!t.imdbId) return null;
      return t.type === 'movie'
        ? `https://fshd.link/filme/${t.imdbId}`
        : `https://fshd.link/serie/${t.imdbId}/${s(t)}/${e(t)}`;
    },
  },
  // VSEmbed (vsembed.ru = VidSrc) REMOVIDO 09/08: é embedder internacional só com
  // LEGENDA PT (ds_lang), sem áudio dublado — foge do foco (PT-BR dublado).
  {
    id: 'embedmovies',
    name: 'Fonte 6 (EmbedMovies PT-BR)',
    // myembed.biz — doc oficial (myembed.biz/api). Aceita TMDB ou IMDB, mesmo
    // esquema do SuperFlix (/filme/{id}, /serie/{id}/{s}/{e}). iframe-only.
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
  // candidatos BR (esquema validado 09/08)
  'https://warezcdn.lat',
  'https://fshd.link',
  'https://myembed.biz',
];
