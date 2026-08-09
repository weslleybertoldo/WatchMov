import { CapacitorHttp, Capacitor } from '@capacitor/core';

// Canais ao vivo do SuperFlix. O endpoint /lista?category=canais devolve id, nome,
// logo, categoria e embed_url (iframe /canal/{id}). NÃO tem CORS → no aparelho a
// busca vai por CapacitorHttp (nativo, sem CORS); no navegador (dev) cai no fetch
// e provavelmente é bloqueado — é feature de APK.
const BASE = 'https://superflixapi.pro';
const LIST_URL = `${BASE}/lista?category=canais&format=json`;
const CACHE_KEY = 'watchmov_livetv';
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface Channel {
  id: string;
  name: string;
  logo: string;
  embed: string;      // URL de iframe (modo servidor)
  category: string;   // categoria "primária" (a 1ª, quando vêm várias)
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
  // navegador (dev): melhor esforço — CORS costuma bloquear.
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

// Categorias na ordem em que aparecem (com "Todos" na frente é responsabilidade da UI).
export function categoriesOf(list: Channel[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of list) if (!seen.has(c.category)) { seen.add(c.category); out.push(c.category); }
  return out.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
