// Regras da rede do app do Windows (W1), sem Electron: dá pra testar com node --test (regras.test.cjs).
// São as mesmas decisões do APK: AppDns.java (DNS), ProxyServer.java (cabeçalhos por host e CORS) e
// MainActivity.java (servidor não abre janela de propaganda). Quem liga isso no Electron é o rede.ts.

/** DNS por HTTPS, na ordem do AppDns.java (Cloudflare → Google). O DNS do sistema fica de reserva. */
export const DOH = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'];

// Vídeo, áudio, legenda e playlist: o que o ProxyServer.java trata como mídia (m3u8, /m3/ e /md/, master.txt…).
const MIDIA = /\.(?:m3u8?|ts|mp4|m4s|m4a|m4v|aac|webm|mkv|vtt|srt|key)(?:[?#]|$)|\/(?:m3|md)\/|\/master|playlist|\.txt(?:[?#]|$)/i;
// Listas do Ao Vivo que o navegador não lê (o servidor não manda CORS). No APK elas vão pelo CapacitorHttp (liveTv.ts).
const LISTAS = [/^https:\/\/superflixapi\.[a-z]+\/lista(?:[/?#]|$)/i, /^https:\/\/iptv-org\.github\.io\//i];

export const ehMidia = (url: string): boolean => MIDIA.test(url);

export function hostDe(url: string): string | null {
  try { return new URL(url).host.toLowerCase() || null; } catch { return null; }
}

export function origemDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const o = new URL(url).origin;
    return o === 'null' ? null : o;
  } catch { return null; }
}

/** Resposta que a PÁGINA do app pode ler mesmo sem CORS do servidor: mídia, as listas do Ao Vivo e os hosts com
 *  cabeçalhos guardados (o player do app busca neles). */
export function precisaCors(url: string, hostsGuardados: ReadonlyMap<string, unknown>): boolean {
  if (MIDIA.test(url) || LISTAS.some((r) => r.test(url))) return true;
  const host = hostDe(url);
  return host !== null && hostsGuardados.has(host);
}

/** Troca um cabeçalho sem duplicar (o servidor manda em qualquer caixa). `null` só apaga. */
export function trocarCabecalho<T>(h: Record<string, T>, nome: string, valor: T | null): void {
  const alvo = nome.toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === alvo) delete h[k];
  if (valor !== null) h[nome] = valor;
}

// Nunca reaproveitados: os que a própria rede monta e o nome do app (X-Requested-With: as Fontes 2/4 bloqueavam por ele).
const NAO_REPETIR = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'x-requested-with']);

/** Cabeçalhos que o servidor usou e que o app repete nos pedidos dele pro mesmo host (= ProxyServer.putHeaders). */
export function cabecalhosGuardaveis(entrada: unknown): Record<string, string> {
  const r: Record<string, string> = {};
  if (!entrada || typeof entrada !== 'object') return r;
  for (const [k, v] of Object.entries(entrada as Record<string, unknown>)) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(k) || NAO_REPETIR.has(k.toLowerCase())) continue;
    r[k] = v;
  }
  return r;
}

/** Põe os cabeçalhos guardados no pedido. Com Referer e sem Origin, o Origin sai do Referer (igual ao ProxyServer). */
export function aplicarCabecalhos(pedido: Record<string, string>, guardados: Record<string, string>): void {
  for (const [k, v] of Object.entries(guardados)) trocarCabecalho(pedido, k, v);
  const nomes = Object.keys(guardados).map((k) => k.toLowerCase());
  if (nomes.includes('referer') && !nomes.includes('origin')) {
    const ref = Object.entries(guardados).find(([k]) => k.toLowerCase() === 'referer')?.[1];
    const origem = origemDe(ref);
    if (origem) trocarCabecalho(pedido, 'Origin', origem);
  }
  trocarCabecalho(pedido, 'X-Requested-With', null);
}

/** A CSP do site só deixa a página buscar e mostrar iframes de poucos endereços (frame-src/connect-src com a lista
 *  de domínios das fontes). O APK não tem CSP (a interface vem do próprio app), e as fontes trocam de domínio
 *  (07/11/2026: o SuperFlix redireciona de .fun pra .boats e a CSP barrava o iframe). No app do Windows o iframe da
 *  fonte e os pedidos da página (vídeo, listas do Ao Vivo) seguem o APK: frame-src e connect-src ganham https:.
 *  O resto da CSP (script-src, object-src, frame-ancestors…) fica como o site mandou. */
export function cspDoApp(csp: string): string {
  const partes = csp.split(';').map((p) => p.trim()).filter(Boolean);
  for (const diretiva of ['connect-src', 'frame-src']) {
    const i = partes.findIndex((p) => p.toLowerCase().startsWith(`${diretiva} `) || p.toLowerCase() === diretiva);
    if (i < 0) continue;   // sem a diretiva vale o default-src; não é o caso do site
    const fontes = partes[i].split(/\s+/).slice(1);
    if (!fontes.includes('*') && !fontes.includes('https:')) partes[i] = `${partes[i]} https:`;
  }
  return partes.join('; ');
}

export type Destino = 'app' | 'fora' | 'bloquear';

/** Janela nova (window.open, link com target): só a página do app abre, e no navegador do PC. Servidor de vídeo
 *  (iframe) não abre nada: propaganda (= onCreateWindow do MainActivity.java). */
export function destinoDaJanela(url: string, origemDoPedido: string | null, origemApp: string): Destino {
  return origemDoPedido === origemApp && /^https?:\/\//i.test(url) ? 'fora' : 'bloquear';
}

/** A janela principal nunca sai do app. Link de fora pedido pela própria página vai pro navegador do PC; um
 *  iframe de servidor tentando trocar a página inteira (propaganda depois de um clique no player) é bloqueado. */
export function destinoDaNavegacao(url: string, origemApp: string, origemDoIniciador: string | null): Destino {
  if (origemDe(url) === origemApp) return 'app';
  return origemDoIniciador === origemApp && /^https?:\/\//i.test(url) ? 'fora' : 'bloquear';
}
