// Rede do app do Windows (W1): o que o APK faz na camada de rede, no processo principal do Electron.
//   1. DNS próprio (= AppDns.java): DNS por HTTPS primeiro. O DNS da operadora (Claro) recusa os servidores de vídeo
//      de várias fontes (sprintcdn…); o DNS do sistema só entra se o DoH estiver fora do ar.
//   2. Cabeçalhos por host e CORS (= ProxyServer.java): a página do app pode ler vídeo e as listas do Ao Vivo, que os
//      servidores não liberam pro navegador, e repete os cabeçalhos que o servidor usou (Referer, Origin, token…).
//   3. Propaganda (= MainActivity.java): servidor de vídeo não abre janela nem troca a página do app.
// As decisões ficam em regras.ts (testadas sem Electron). O Electron aceita UM ouvinte por evento do webRequest:
// quem mais precisar ver os pedidos (a captura do link, W2) entra por aqui.
import { randomBytes } from 'node:crypto';
import { app, ipcMain, net, protocol, session, shell, type WebContents, type WebFrameMain } from 'electron';
import {
  DOH, ESQUEMA_VIDEO, alvoDoVideo, aplicarCabecalhos, cabecalhosGuardaveis, destinoDaJanela, destinoDaNavegacao, ehArquivoBaixado, ehMidia,
  hostDe, cspDoApp, origemDe, precisaCors, refererDoPedido, trocarCabecalho,
} from './regras';

/** Esquema do vídeo do player do app (regras.ts, ESQUEMA_VIDEO). O Electron só aceita isso uma vez, ANTES do `ready`:
 *  com CORS e fetch (o hls.js lê por XHR), seguro como https e fora da CSP do site (a CSP é da página, não do app). */
export function registrarEsquemaVideo(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: ESQUEMA_VIDEO,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true },
  }]);
}

const CORS_DO_VIDEO: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Accept-Ranges',
};
const REPASSAR = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag'];
// Chave do esquema do vídeo: sorteada a cada abertura; só a página do app recebe (pelo preload da janela do app).
const CHAVE_VIDEO = randomBytes(18).toString('base64url');
const janelasDoApp = new Set<number>();

const porHost = new Map<string, Record<string, string>>();
const estado = { janelasBloqueadas: 0, navegacoesBloqueadas: 0, ultimaBloqueada: '' };
// Cabeçalhos do link que o player do app está tocando (W2): valem pra TODO pedido de mídia da página, em qualquer
// host (os pedaços do HLS costumam vir de outro servidor). Igual ao ProxyServer do APK, que repete os do link.
let daReproducao: Record<string, string> | null = null;

/** Quem mais precisa ver cada pedido (a captura do link, W2) e quem pode cancelar um (recurso que a janela escondida
 *  não carrega). O Electron aceita um ouvinte por evento do webRequest, por isso passa tudo por aqui. */
export interface PedidoVisto { url: string; webContentsId?: number; requestHeaders: Record<string, string>; resourceType: string }
const observadores: Array<(d: PedidoVisto) => void> = [];
const barreiras: Array<(webContentsId: number | undefined, url: string) => boolean> = [];
export function aoPedido(cb: (d: PedidoVisto) => void): void { observadores.push(cb); }
export function aoBloquear(fn: (webContentsId: number | undefined, url: string) => boolean): void { barreiras.push(fn); }

/** Cabeçalhos que o app repete nos pedidos a esse endereço: os guardados do host ou, se for mídia, os do link que o
 *  player está tocando. O download (downloads.ts) começa com eles, como o player. */
export function cabecalhosPara(url: string): Record<string, string> {
  return { ...(porHost.get(hostDe(url) ?? '') ?? (daReproducao && ehMidia(url) ? daReproducao : {})) };
}

// Arquivo baixado (W4, downloads.ts) pelo mesmo esquema do vídeo: wm-video://arquivo/?t=<chave>&k=<download>.
let arquivoLocal: ((pedido: Request) => Promise<Response>) | null = null;
export function aoPedirArquivo(fn: (pedido: Request) => Promise<Response>): void { arquivoLocal = fn; }

/** Guarda os cabeçalhos que valem pros pedidos da página do app a esse host (e libera o CORS dele). */
export function guardarCabecalhos(url: string, cabecalhos: unknown): boolean {
  const host = hostDe(url);
  const limpos = cabecalhosGuardaveis(cabecalhos);
  if (!host || !/^https?:/i.test(url) || !Object.keys(limpos).length) return false;
  porHost.set(host, limpos);
  return true;
}

export function origemDoFrame(frame: WebFrameMain | null | undefined): string | null {
  try {
    if (!frame) return null;
    return frame.origin && frame.origin !== 'null' ? frame.origin : origemDe(frame.url);
  } catch { return null; }   // frame já fechado
}

function contarBloqueio(tipo: 'janela' | 'navegação', url: string) {
  if (tipo === 'janela') estado.janelasBloqueadas++;
  else estado.navegacoesBloqueadas++;
  estado.ultimaBloqueada = hostDe(url) ?? url.slice(0, 80);
  console.log(`[wm] propaganda bloqueada (${tipo}): ${estado.ultimaBloqueada} · janelas ${estado.janelasBloqueadas}, navegações ${estado.navegacoesBloqueadas}`);
}

/** Liga DNS, cabeçalhos e CORS. Chamar depois do `ready`. `origemApp` = origem do site que a janela abre. */
export function ligarRede(origemApp: string): void {
  app.configureHostResolver({ secureDnsMode: 'automatic', secureDnsServers: DOH });

  // Pedido feito pela página do app (não por um iframe de servidor): o frame diz quem pediu. Documento (a página ou
  // um iframe) não entra: CORS e cabeçalhos guardados são só pros pedidos que a página faz (vídeo, listas).
  const daPagina = (d: { frame?: WebFrameMain | null; referrer: string; resourceType: string }) =>
    d.resourceType !== 'mainFrame' && d.resourceType !== 'subFrame' &&
    (origemDoFrame(d.frame) ?? origemDe(d.referrer)) === origemApp;
  const filtro = { urls: ['https://*/*', 'http://*/*'] };

  session.defaultSession.webRequest.onBeforeRequest(filtro, (d, cb) => {
    cb(barreiras.some((f) => f(d.webContentsId, d.url)) ? { cancel: true } : {});
  });

  session.defaultSession.webRequest.onBeforeSendHeaders(filtro, (d, cb) => {
    for (const o of observadores) {
      try { o({ url: d.url, webContentsId: d.webContentsId, requestHeaders: d.requestHeaders, resourceType: d.resourceType }); }
      catch (e) { console.warn('[wm] captura:', e); }
    }
    const guardados = porHost.get(hostDe(d.url) ?? '') ?? (daReproducao && ehMidia(d.url) ? daReproducao : undefined);
    if (!guardados || !daPagina(d)) return cb({});
    const pedido = { ...d.requestHeaders };
    aplicarCabecalhos(pedido, guardados);
    cb({ requestHeaders: pedido });
  });

  session.defaultSession.webRequest.onHeadersReceived(filtro, (d, cb) => {
    const destino = origemDe(d.url);
    if (destino === origemApp) {
      if (d.resourceType !== 'mainFrame' || !d.responseHeaders) return cb({});
      // A página do app: a CSP do site ganha https: no connect-src e no frame-src (só no app do Windows; regras.ts).
      const h = { ...d.responseHeaders };
      const nome = Object.keys(h).find((k) => k.toLowerCase() === 'content-security-policy');
      if (!nome) return cb({});
      h[nome] = h[nome].map(cspDoApp);
      return cb({ responseHeaders: h });
    }
    if (!daPagina(d) || !precisaCors(d.url, porHost)) return cb({});
    // "*" e não a origem do app: depois de um redirecionamento pra outro domínio (a lista do SuperFlix vai de
    // superflixapi.pro pra .fun) o navegador manda Origin: null. Os pedidos da página ao vídeo e às listas vão sem
    // credenciais (cookie, quando o servidor exige, entra pelos cabeçalhos guardados), então "*" vale sempre.
    const h = { ...(d.responseHeaders ?? {}) };
    trocarCabecalho(h, 'Access-Control-Allow-Origin', ['*']);
    trocarCabecalho(h, 'Access-Control-Expose-Headers', ['Content-Length, Content-Range, Content-Type, Accept-Ranges']);
    cb({ responseHeaders: h });
  });

  ipcMain.handle('wm:rede-cabecalhos', (e, url: unknown, cabecalhos: unknown) =>
    origemDoFrame(e.senderFrame) === origemApp && typeof url === 'string' && guardarCabecalhos(url, cabecalhos));
  ipcMain.handle('wm:rede-estado', () => ({ ...estado, dns: 'DoH (Cloudflare, Google); DNS do sistema de reserva', hosts: porHost.size }));
  // Vídeo do player do app (W2): a playlist e os pedaços vêm por aqui, com os cabeçalhos do link (Referer, Origin,
  // cookie…) e sem CORS, igual ao player nativo do APK. Só a página do app usa (um iframe de servidor não).
  // O pedido ao esquema não traz Origin: quem prova que é a página do app é a chave (só o preload dela recebe).
  ipcMain.on('wm:video-chave', (e) => { e.returnValue = janelasDoApp.has(e.sender.id) ? CHAVE_VIDEO : ''; });
  protocol.handle(ESQUEMA_VIDEO, async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_DO_VIDEO });
    if (ehArquivoBaixado(req.url)) {
      // Mesma chave do vídeo: só a página do app abre os arquivos baixados.
      if (!arquivoLocal || new URL(req.url).searchParams.get('t') !== CHAVE_VIDEO) return new Response(null, { status: 403, headers: CORS_DO_VIDEO });
      return arquivoLocal(req);
    }
    const alvo = alvoDoVideo(req.url, CHAVE_VIDEO);
    if (!alvo) {
      console.warn('[wm] vídeo: pedido sem a chave da página do app ou pra endereço local, recusado');
      return new Response(null, { status: 403, headers: CORS_DO_VIDEO });
    }
    const pedido: Record<string, string> = {};
    if (daReproducao) aplicarCabecalhos(pedido, daReproducao);
    const faixa = req.headers.get('range');
    if (faixa) pedido.Range = faixa;
    // Referer no formato que o Chromium aceita pra este endereço (regras.ts, refererDoPedido): com o endereço inteiro
    // do player num pedaço de outro servidor, o pedido era cancelado (Fonte 3).
    const nomeReferer = Object.keys(pedido).find((k) => k.toLowerCase() === 'referer');
    if (nomeReferer) {
      const ref = refererDoPedido(pedido[nomeReferer], alvo);
      if (ref) pedido[nomeReferer] = ref;
      else delete pedido[nomeReferer];
    }
    // Sem Origin: no net.fetch ele vira pedido CORS do Chromium (iniciador = o servidor) e o init.mp4 da WatchPlay
    // (Fonte 1) falhava com net::ERR_FAILED vindo do cache (07/11/2026). As fontes tocam sem ele (provado nas Fontes
    // 1, 2, 3, 4 e 7); com o Origin tirado do Referer, a CDN da Fonte 7 (playercdnn.workers.dev) respondeu 403
    // (08/11/2026).
    trocarCabecalho(pedido, 'Origin', null);
    try {
      const r = await net.fetch(alvo, {
        headers: pedido, bypassCustomProtocolHandlers: true, cache: 'no-store', signal: AbortSignal.timeout(60000),
      });
      const h = new Headers(CORS_DO_VIDEO);
      for (const nome of REPASSAR) {
        const v = r.headers.get(nome);
        if (v) h.set(nome, v);
      }
      if (!r.ok) console.warn(`[wm] vídeo: ${r.status} em ${alvo.slice(0, 90)}`);
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    } catch (e) {
      console.warn(`[wm] vídeo: falhou ${alvo.slice(0, 90)}: ${String(e).slice(0, 160)}`);
      return new Response(null, { status: 502, headers: CORS_DO_VIDEO });
    }
  });

  ipcMain.handle('wm:rede-reproducao', (e, cabecalhos: unknown) => {
    if (origemDoFrame(e.senderFrame) !== origemApp) return false;
    const limpos = cabecalhos ? cabecalhosGuardaveis(cabecalhos) : {};
    daReproducao = Object.keys(limpos).length ? limpos : null;
    return true;
  });
}

/** Janela do app: propaganda dos servidores não abre janela nem troca a página. Link de fora → navegador do PC. */
export function protegerJanela(wc: WebContents, origemApp: string): void {
  janelasDoApp.add(wc.id);
  wc.once('destroyed', () => janelasDoApp.delete(wc.id));
  wc.setWindowOpenHandler(({ url, referrer }) => {
    if (destinoDaJanela(url, origemDe(referrer.url), origemApp) === 'fora') void shell.openExternal(url);
    else contarBloqueio('janela', url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => {
    const destino = destinoDaNavegacao(e.url, origemApp, origemDoFrame(e.initiator));
    if (destino === 'app') return;
    e.preventDefault();
    if (destino === 'fora') void shell.openExternal(e.url);
    else contarBloqueio('navegação', e.url);
  });
}
