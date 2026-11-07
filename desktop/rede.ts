// Rede do app do Windows (W1): o que o APK faz na camada de rede, no processo principal do Electron.
//   1. DNS próprio (= AppDns.java): DNS por HTTPS primeiro. O DNS da operadora (Claro) recusa os servidores de vídeo
//      de várias fontes (sprintcdn…); o DNS do sistema só entra se o DoH estiver fora do ar.
//   2. Cabeçalhos por host e CORS (= ProxyServer.java): a página do app pode ler vídeo e as listas do Ao Vivo, que os
//      servidores não liberam pro navegador, e repete os cabeçalhos que o servidor usou (Referer, Origin, token…).
//   3. Propaganda (= MainActivity.java): servidor de vídeo não abre janela nem troca a página do app.
// As decisões ficam em regras.ts (testadas sem Electron). O Electron aceita UM ouvinte por evento do webRequest:
// quem mais precisar ver os pedidos (a captura do link, W2) entra por aqui.
import { app, ipcMain, session, shell, type WebContents, type WebFrameMain } from 'electron';
import {
  DOH, aplicarCabecalhos, cabecalhosGuardaveis, destinoDaJanela, destinoDaNavegacao, hostDe, cspDoApp,
  origemDe, precisaCors, trocarCabecalho,
} from './regras';

const porHost = new Map<string, Record<string, string>>();
const estado = { janelasBloqueadas: 0, navegacoesBloqueadas: 0, ultimaBloqueada: '' };

/** Guarda os cabeçalhos que valem pros pedidos da página do app a esse host (e libera o CORS dele). */
export function guardarCabecalhos(url: string, cabecalhos: unknown): boolean {
  const host = hostDe(url);
  const limpos = cabecalhosGuardaveis(cabecalhos);
  if (!host || !/^https?:/i.test(url) || !Object.keys(limpos).length) return false;
  porHost.set(host, limpos);
  return true;
}

function origemDoFrame(frame: WebFrameMain | null | undefined): string | null {
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

  session.defaultSession.webRequest.onBeforeSendHeaders(filtro, (d, cb) => {
    const guardados = porHost.get(hostDe(d.url) ?? '');
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
}

/** Janela do app: propaganda dos servidores não abre janela nem troca a página. Link de fora → navegador do PC. */
export function protegerJanela(wc: WebContents, origemApp: string): void {
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
