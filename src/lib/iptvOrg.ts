// Canais do iptv-org (github.com/iptv-org/iptv): listas M3U públicas de canais ao vivo, atualizadas todo dia pelo
// projeto. Pedido do Weslley (03/11/2026): os do Brasil entram nas categorias da aba Ao Vivo e o resto do mundo numa
// última aba "Mundo", organizada por categoria também.
//   Brasil = countries/br.m3u (~400 canais, ~100 KB) · Mundo = index.m3u (~11 mil, ~2,6 MB), sem os links do Brasil.
// O GitHub Pages responde com CORS liberado (`*`), então o fetch comum do WebView serve (sem CapacitorHttp).

export const IPTV_BR_URL = 'https://iptv-org.github.io/iptv/countries/br.m3u';
export const IPTV_MUNDO_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const CACHE_BR = 'watchmov_iptv_br';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h, igual aos canais do SuperFlix

export interface IptvChannel {
  url: string;
  name: string;
  logo: string;
  categories: string[]; // em português, na ordem da lista
  country: string;      // 'br', 'us'… ('' quando o id não diz)
  referer?: string;
  ua?: string;
}

// Nomes em português. Os que o SuperFlix também tem usam o MESMO nome: a aba junta as duas fontes por categoria.
const CATEGORIAS: Record<string, string> = {
  general: 'Geral',
  entertainment: 'Variedades',
  news: 'Notícias',
  movies: 'Filmes',
  series: 'Séries',
  kids: 'Infantil',
  animation: 'Desenhos',
  documentary: 'Documentários',
  sports: 'Esportes',
  music: 'Música',
  religious: 'Religiosos',
  education: 'Educação',
  comedy: 'Comédia',
  culture: 'Cultura',
  legislative: 'Legislativo',
  lifestyle: 'Estilo de vida',
  classic: 'Clássicos',
  outdoor: 'Aventura',
  shop: 'Compras',
  business: 'Negócios',
  family: 'Família',
  travel: 'Viagem',
  cooking: 'Culinária',
  public: 'Públicos',
  auto: 'Carros',
  science: 'Ciência',
  weather: 'Clima',
  relax: 'Relaxar',
  interactive: 'Interativos',
  undefined: 'Outros',
};
// Canal adulto nunca entra (a lista principal do iptv-org já tira; a regra fica aqui também).
const FORA = new Set(['xxx']);

/** "Sports" → "Esportes"; null = categoria que não entra (adulto). Desconhecida fica com o nome original. */
export function traduzirCategoria(nome: string): string | null {
  const k = nome.trim().toLowerCase();
  if (!k) return 'Outros';
  if (FORA.has(k)) return null;
  return CATEGORIAS[k] ?? nome.trim();
}

/** "Band (720p) [Geo-blocked]" → "Band". Tira as marcas entre colchetes e a qualidade "(1080p)". */
export function limparNome(nome: string): string {
  const limpo = nome
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\(\d{3,4}[pi]\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpo || nome.trim();
}

/** País pelo tvg-id ("RedeGlobo.br@SD" → "br"); '' quando não dá pra saber. */
export function paisDoId(id: string): string {
  const m = /\.([a-z]{2})(?:@|$)/i.exec(id.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Bandeira em emoji ("br" → 🇧🇷). O iptv-org usa "uk" pro Reino Unido (a bandeira é a "gb"). */
export function bandeira(pais: string): string {
  const cc = (pais === 'uk' ? 'gb' : pais).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Tipo pro player nativo: .mpd = DASH, .mp4 = MP4, .ts/.flv/áudio = o player descobre sozinho, resto = HLS
 *  (m3u8 ou link sem extensão, que no iptv-org é quase sempre HLS). */
export function mimeDoLink(url: string): string | undefined {
  const caminho = url.split(/[?#]/)[0].toLowerCase();
  if (caminho.endsWith('.mpd')) return 'application/dash+xml';
  if (caminho.endsWith('.mp4')) return 'video/mp4';
  if (/\.(ts|flv|aac|mp3)$/.test(caminho)) return undefined;
  return 'application/x-mpegURL';
}

interface Extinf { nome: string; logo: string; id: string; grupos: string }

// #EXTINF:-1 tvg-id="X" tvg-logo="Y" group-title="A;B",Nome do canal — o nome começa na 1ª vírgula FORA das aspas.
function lerExtinf(linha: string): Extinf {
  let dentro = false;
  let corte = -1;
  for (let i = '#EXTINF:'.length; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') dentro = !dentro;
    else if (ch === ',' && !dentro) { corte = i; break; }
  }
  const atributos = corte < 0 ? linha : linha.slice(0, corte);
  const nome = corte < 0 ? '' : linha.slice(corte + 1).trim();
  const a: Record<string, string> = {};
  for (const m of atributos.matchAll(/([a-z0-9-]+)="([^"]*)"/gi)) a[m[1].toLowerCase()] = m[2];
  return { nome, logo: a['tvg-logo'] ?? '', id: a['tvg-id'] ?? '', grupos: a['group-title'] ?? '' };
}

/** Lê uma lista M3U do iptv-org. Fica de fora: canal adulto, link que não é http(s) (rtmp, udp…) e link repetido. */
export function parseM3u(texto: string): IptvChannel[] {
  const out: IptvChannel[] = [];
  const vistos = new Set<string>();
  let atual: IptvChannel | null = null;
  let fora = false;
  for (const bruta of texto.split('\n')) {
    const linha = bruta.trim();
    if (!linha) continue;
    if (linha.startsWith('#EXTINF:')) {
      const e = lerExtinf(linha);
      const cats: string[] = [];
      fora = false;
      for (const g of e.grupos.split(';')) {
        const t = traduzirCategoria(g);
        if (t === null) { fora = true; break; }
        if (!cats.includes(t)) cats.push(t);
      }
      atual = {
        url: '',
        name: limparNome(e.nome) || 'Canal',
        logo: e.logo,
        categories: cats.length ? cats : ['Outros'],
        country: paisDoId(e.id),
      };
      continue;
    }
    if (linha.startsWith('#EXTVLCOPT:')) {
      if (!atual) continue;
      const opcao = linha.slice('#EXTVLCOPT:'.length);
      const i = opcao.indexOf('=');
      if (i < 0) continue;
      const chave = opcao.slice(0, i).trim().toLowerCase();
      const valor = opcao.slice(i + 1).trim();
      if (chave === 'http-referrer') atual.referer = valor;
      else if (chave === 'http-user-agent') atual.ua = valor;
      continue;
    }
    if (linha.startsWith('#')) continue;
    if (atual && !fora && /^https?:\/\//i.test(linha) && !vistos.has(linha)) {
      vistos.add(linha);
      out.push({ ...atual, url: linha });
    }
    atual = null;
    fora = false;
  }
  return out;
}

async function baixar(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`iptv-org respondeu ${r.status}`);
  return r.text();
}

/** Canais do Brasil (cache de 6 h no aparelho, como os do SuperFlix). */
export async function fetchIptvBrasil(force = false): Promise<IptvChannel[]> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_BR) || 'null');
      if (cached && Date.now() - cached.ts < TTL_MS && Array.isArray(cached.list) && cached.list.length) {
        return cached.list as IptvChannel[];
      }
    } catch { /* ignore */ }
  }
  const list = parseM3u(await baixar(IPTV_BR_URL));
  if (!list.length) throw new Error('lista do Brasil veio vazia');
  try { localStorage.setItem(CACHE_BR, JSON.stringify({ ts: Date.now(), list })); } catch { /* ignore */ }
  return list;
}

// O Mundo (~2,6 MB) não cabe com folga no localStorage: fica na memória da sessão (6 h) e o navegador ainda guarda
// o arquivo por 10 min (cache-control do GitHub Pages).
let mundo: { ts: number; list: IptvChannel[] } | null = null;
let mundoEmVoo: Promise<IptvChannel[]> | null = null;

/** Canais do mundo, sem os do Brasil (esses já estão nas categorias da aba). Só baixa quando a aba Mundo abre. */
export async function fetchIptvMundo(force = false): Promise<IptvChannel[]> {
  if (!force && mundo && Date.now() - mundo.ts < TTL_MS) return mundo.list;
  if (mundoEmVoo) return mundoEmVoo;
  mundoEmVoo = (async () => {
    const [texto, brasil] = await Promise.all([
      baixar(IPTV_MUNDO_URL),
      fetchIptvBrasil().catch(() => [] as IptvChannel[]),
    ]);
    const doBrasil = new Set(brasil.map(c => c.url));
    const list = parseM3u(texto).filter(c => c.country !== 'br' && !doBrasil.has(c.url));
    if (!list.length) throw new Error('lista do mundo veio vazia');
    mundo = { ts: Date.now(), list };
    return list;
  })().finally(() => { mundoEmVoo = null; });
  return mundoEmVoo;
}
