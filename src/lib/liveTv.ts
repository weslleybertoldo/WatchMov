import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { fetchIptvBrasil, fetchIptvMundo, type IptvChannel } from './iptvOrg';

// Canais ao vivo do SuperFlix. O endpoint /lista?category=canais devolve id, nome,
// logo, categoria e embed_url (iframe /canal/{id}). NÃO tem CORS → no aparelho a
// busca vai por CapacitorHttp (nativo, sem CORS); no app do Windows vai pelo fetch e o
// processo principal libera o CORS da lista (desktop/rede.ts); no navegador o fetch
// é bloqueado e só os canais do iptv-org aparecem.
const BASE = 'https://superflixapi.pro';
const LIST_URL = `${BASE}/lista?category=canais&format=json`;
const CACHE_KEY = 'watchmov_livetv';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface Channel {
  id: string;
  name: string;
  logo: string;
  embed: string;      // URL de iframe (modo servidor) — só os do SuperFlix; '' nos do iptv-org
  category: string;   // categoria "primária" (a 1ª, quando vêm várias)
  // 03/11/2026 — canais do iptv-org (lista M3U pública): link direto do vídeo, tocado no player nativo.
  categories?: string[]; // todas as categorias (no iptv-org um canal pode estar em mais de uma)
  url?: string;          // link direto (HLS/DASH)
  referer?: string;
  ua?: string;
  country?: string;      // país (bandeira no Mundo)
}

interface RawChannel {
  id?: string;
  name?: string;
  logo_url?: string;
  embed_url?: string;
  category?: string;
  is_active?: boolean;
}

function normalize(raw: RawChannel[]): Channel[] {
  return raw
    .filter(c => c && c.id && c.embed_url && c.is_active !== false)
    .map(c => ({
      id: String(c.id),
      name: c.name || String(c.id),
      logo: c.logo_url || '',
      embed: c.embed_url as string,
      // a API às vezes manda "A • B" — a categoria primária é a 1ª.
      category: (c.category || 'Outros').split('•')[0].trim() || 'Outros',
    }));
}

async function fetchRaw(): Promise<RawChannel[]> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url: LIST_URL, headers: { Accept: 'application/json' } });
    const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    return body?.data ?? [];
  }
  // app do Windows: o CORS sai liberado (desktop/rede.ts). Navegador: melhor esforço — o CORS bloqueia.
  const r = await fetch(LIST_URL, { headers: { Accept: 'application/json' } });
  const body = await r.json();
  return body?.data ?? [];
}

export async function fetchChannels(force = false): Promise<Channel[]> {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < TTL_MS && Array.isArray(cached.list) && cached.list.length) {
        return cached.list as Channel[];
      }
    } catch { /* ignore */ }
  }
  const list = normalize(await fetchRaw());
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list })); } catch { /* ignore */ }
  return list;
}

// Canal do iptv-org no formato da aba.
export function doIptv(c: IptvChannel): Channel {
  return {
    id: `iptv:${c.url}`,
    name: c.name,
    logo: c.logo,
    embed: '',
    category: c.categories[0] ?? 'Outros',
    categories: c.categories,
    url: c.url,
    referer: c.referer,
    ua: c.ua,
    country: c.country,
  };
}

// Aba Ao Vivo (Brasil) = SuperFlix + iptv-org do Brasil, nas mesmas categorias. Uma fonte fora do ar não derruba a
// outra (no navegador o SuperFlix nem responde: sem CORS); só as duas fora = erro na tela.
export async function fetchAoVivo(force = false): Promise<Channel[]> {
  const [superflix, iptv] = await Promise.allSettled([fetchChannels(force), fetchIptvBrasil(force)]);
  const list = [
    ...(superflix.status === 'fulfilled' ? superflix.value : []),
    ...(iptv.status === 'fulfilled' ? iptv.value.map(doIptv) : []),
  ];
  if (!list.length) {
    const falha = [superflix, iptv].find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw falha ? falha.reason : new Error('nenhum canal');
  }
  return list;
}

// Última aba "Mundo": iptv-org do mundo todo, sem os do Brasil. Só baixa quando a aba abre.
export async function fetchMundo(force = false): Promise<Channel[]> {
  return (await fetchIptvMundo(force)).map(doIptv);
}

export function categoriasDo(c: Channel): string[] {
  return c.categories?.length ? c.categories : [c.category];
}

// Categorias em ordem alfabética (com "Todos" na frente é responsabilidade da UI). Canal com várias conta em todas.
export function categoriesOf(list: Channel[]): string[] {
  const seen = new Set<string>();
  for (const c of list) for (const k of categoriasDo(c)) seen.add(k);
  return [...seen].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Filtro da aba: categoria (null = todas) + busca pelo nome, sem diferenciar acento nem maiúscula.
export function filtrarCanais(list: Channel[], categoria: string | null, termo: string): Channel[] {
  const t = semAcento(termo.trim());
  return list.filter(c =>
    (!categoria || categoriasDo(c).includes(categoria)) &&
    (!t || semAcento(c.name).includes(t)));
}
