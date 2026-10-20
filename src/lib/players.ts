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
  // Etiqueta curta + cor do link no picker "Links do vídeo". Fica AQUI, junto do
  // build(), pra fonte nova nascer com tag: antes era um if chapado no VideoPlayer
  // que só conhecia SuperFlix e EmbedPlay, e as outras 4 ficavam sem identificação.
  tag: string;
  color: string;
  build: (t: PlayerTarget) => string | null;
}

const s = (t: PlayerTarget) => t.season ?? 1;
const e = (t: PlayerTarget) => t.episode ?? 1;

// Ordem = numeração das fontes na tela (Fonte 1…6). Nova ordem 17/10/2026 (pedido dele): as que funcionam primeiro e
// as que bloqueiam no fim — 1 EmbedMovies, 2 EmbedPlay, 3 FS/HD, 4 SuperFlix, 5 WarezCDN (antes: 6, 1, 5, 2, 4).
// 19/10/2026: a Pomfy entra como Fonte 4 (funciona, áudio dublado + original) → SuperFlix vira 5 e WarezCDN 6.
// A Fonte 3 antiga (Fembed, fembed.lol) foi REMOVIDA no mesmo dia ("remove a 3, a 3 é a mesma da 2"): a página só juntava
// outras — abria na SuperFlix e tinha EmbedPlay, MyEmbed e uma em inglês. Os ids não mudam, então favorito, fonte
// escolhida por título e links salvos continuam valendo. O PADRÃO do "Assistir" é o favorito (favoriteServer.ts).
// Removidas antes: BetterFlix/VidAPI (domínios mortos/propaganda); 09/08 PlayerFlix, OverflixTV, Roxano, MostraFlix e
// VisionCine (slug sem rota por id ou domínio morto); VSEmbed (vsembed.ru = VidSrc, só legenda PT).
// 20/10/2026: a MegaEmbed (saiu em 09/08 com o domínio velho megaembedapi.site) VOLTA como Fonte 7, no domínio novo, e no
// fim da lista pra não renumerar as outras (pedido dele "1 e 3").
export const PROVIDERS: Provider[] = [
  {
    id: 'embedmovies',
    name: 'Fonte 1 (EmbedMovies PT-BR)',   // PADRÃO quando não há favorito (favoriteServer.ts)
    tag: 'EmbedMovies', color: '#22d3ee',
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
  {
    id: 'embedplayapi',
    name: 'Fonte 2 (EmbedPlayApi PT-BR)',
    tag: 'EmbedPlay', color: '#60a5fa',
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
    id: 'fshd',
    name: 'Fonte 3 (FS/HD PT-BR)',
    tag: 'FS/HD', color: '#c084fc',
    // IMDB id — confirmado no navegador (fshd.link/filme/tt1375666).
    build: (t) => {
      if (!t.imdbId) return null;
      return t.type === 'movie'
        ? `https://fshd.link/filme/${t.imdbId}`
        : `https://fshd.link/serie/${t.imdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'pomfy',
    name: 'Fonte 4 (Pomfy PT-BR DUB+EN)',
    tag: 'Pomfy', color: '#34d399',
    // api.pomfy.stream — doc oficial na própria página. Só TMDB id (/filme/{id}, /serie/{id}/{s}/{e}). Abre SÓ
    // dentro de iframe: aberta direto dá 403 (o servidor confere o Sec-Fetch-Dest) → o resolvedor monta um iframe
    // (IFRAME_PROVIDERS). "Assistir" → "Servidor 1" → gate da Byse → HLS com 2 áudios: Português (padrão) e English.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://api.pomfy.stream/filme/${t.tmdbId}`
        : `https://api.pomfy.stream/serie/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
  {
    id: 'superflix',
    name: 'Fonte 5 (SuperFlix PT-BR DUB+LEG)',
    tag: 'SuperFlix', color: '#f87171',
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
    id: 'warezcdn',
    name: 'Fonte 6 (WarezCDN PT-BR)',
    tag: 'WarezCDN', color: '#fbbf24',
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
    id: 'megaembed',
    name: 'Fonte 7 (MegaEmbed PT-BR)',
    tag: 'MegaEmbed', color: '#fb923c',
    // megaembed.com — mesmo endereço do plugin do Nuvio. Só TMDB id (/embed/{id}, /embed/{id}/{s}/{e}). A página traz a
    // lista de opções escrita (`sources`); no app ela é lida por HTTP (megaembed.ts), sem o WebView oculto.
    build: (t) => {
      if (!t.tmdbId) return null;
      return t.type === 'movie'
        ? `https://megaembed.com/embed/${t.tmdbId}`
        : `https://megaembed.com/embed/${t.tmdbId}/${s(t)}/${e(t)}`;
    },
  },
];

// Domínios usados (para CSP frame-src — o valor que vale está em vercel.json; só a web usa CSP)
export const PROVIDER_HOSTS = [
  'https://fembed.sx',
  'https://embedplayapi.top',
  'https://superflixapi.cyou',
  // candidatos BR (esquema validado 09/08)
  'https://warezcdn.lat',
  'https://fshd.link',
  'https://myembed.biz',
  // redirects atuais (14/09/2026): .cyou/.pro → .monster; fembed.sx → fembed.lol; warezcdn.lat → warezcdn.sbs
  'https://superflixapi.monster',
  'https://fembed.lol',
  'https://warezcdn.sbs',
  'https://api.pomfy.stream',
  'https://megaembed.com',
];

// Rótulo "servidor · player" do topo do player nativo (pedido dele 17/10/2026: "6 - nome do servidor - nome do player
// escolhido"): número da fonte, etiqueta dela e a opção (player) escolhida dentro do servidor, quando houver.
export function rotuloDaFonte(providerId?: string, opcao?: string): string {
  const p = providerId ? PROVIDERS.find(x => x.id === providerId) : undefined;
  const num = p ? /Fonte\s+(\d+)/.exec(p.name)?.[1] : undefined;
  const op = opcao?.replace(/\s+/g, ' ').trim();
  return [num, p?.tag, op].filter(Boolean).join(' · ');
}
