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
  // Fonte 4 (MegaEmbed) e Fonte 5 (PlayerFlix) removidas 09/08 — pedido do Weslley.
  // ── Candidatos BR pra TESTAR no aparelho (09/08) ──────────────────────────────
  // ⚠️ Esquema de URL é PALPITE (padrão SuperFlix /filme//serie): do IP daqui os
  // sites dão Cloudflare 000/403, só o celular alcança. Se a fonte não listar nada,
  // o esquema está errado → reportar que eu ajusto por site.
  {
    id: 'warezcdn',
    name: 'Fonte 4 (WarezCDN — testar)',
    build: (t) => {                                   // WarezCDN usa IMDB id
      if (!t.imdbId) return null;
      return t.type === 'movie'
        ? `https://embed.warezcdn.com/filme/${t.imdbId}`
        : `https://embed.warezcdn.com/serie/${t.imdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'overflixtv',
    name: 'Fonte 5 (OverflixTV — testar)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://overflixtv.top/filme/${t.tmdbId}`
        : `https://overflixtv.top/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'roxano',
    name: 'Fonte 6 (Roxano — testar)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://roxano.top/filme/${t.tmdbId}`
        : `https://roxano.top/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'mostraflix',
    name: 'Fonte 7 (MostraFlix — testar)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://mostraflix.top/filme/${t.tmdbId}`
        : `https://mostraflix.top/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'visioncine',
    name: 'Fonte 8 (VisionCine — testar)',
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://visioncine.xyz/filme/${t.tmdbId}`
        : `https://visioncine.xyz/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  // Achados no agregador onlinefilmer.net (Pobreflix) — esquema por IMDB confirmado
  // p/ filme; série é palpite.
  {
    id: 'fshd',
    name: 'Fonte 9 (FS/HD — testar)',
    build: (t) => {                                   // IMDB id
      if (!t.imdbId) return null;
      return t.type === 'movie'
        ? `https://fshd.link/filme/${t.imdbId}`
        : `https://fshd.link/serie/${t.imdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'vsembed',
    name: 'Fonte 10 (VSEmbed — testar)',
    build: (t) => {                                   // IMDB id, querystring
      if (!t.imdbId) return null;
      return t.type === 'movie'
        ? `https://vsembed.ru/embed/movie?imdb=${t.imdbId}`
        : `https://vsembed.ru/embed/tv?imdb=${t.imdbId}&sea=${s(t)}&epi=${e(t)}`;
    },
  },
];

// Domínios usados (para CSP frame-src)
export const PROVIDER_HOSTS = [
  'https://fembed.sx',
  'https://embedplayapi.top',
  'https://superflixapi.cyou',
  // candidatos BR em teste (09/08)
  'https://embed.warezcdn.com',
  'https://overflixtv.top',
  'https://roxano.top',
  'https://mostraflix.top',
  'https://visioncine.xyz',
  'https://fshd.link',
  'https://vsembed.ru',
];
