// Captura do link e resolvedor do app do Windows (W2): o StreamSnifferPlugin.java e o ResolverPlugin.java no Electron.
//  - Captura: os pedidos de rede da janela do app e da janela escondida passam por aqui (o rede.ts repassa: o Electron
//    aceita um ouvinte por evento do webRequest). Vídeo (m3u8, mp4, master…) vira o evento streamFound, com os
//    cabeçalhos que o navegador usou (o player repete). Sem extensão conhecida, o começo do arquivo diz se é vídeo.
//  - Resolvedor: uma janela ESCONDIDA abre a página da fonte com os mesmos cookies do app. O script do site
//    (src/lib/resolver.ts) roda em TODO frame desde o começo (captura-preload.ts) e conversa pelo console (WMOPT,
//    WMBLOG); aqui ficam o ciclo de opções, os prazos e os eventos, os mesmos do Android, pro site não mudar.
// No PC não há o ProxyServer do APK: sem o motor do ABYS (o site nem manda o script dele pro desktop).
import { BrowserWindow, ipcMain, net } from 'electron';
import path from 'node:path';
import { aoPedido, type PedidoVisto } from './rede';
import {
  OPCAO_MAX_MS, bloqueado, cabecalho, cabecalhosDoLink, campo, derrubar, kDoRecado, mimeDe, mimePeloComeco,
  naoEConteudo, navegacaoPermitida, paginaComIframe, pareceVideo, pontoDoClique, pularSonda, qualidadeDoMaster,
  semQuery, tipoDeVideo,
} from './regrasCaptura';

type Evento = 'streamFound' | 'streamQuality' | 'resolverEvent';
let enviarAoApp: (evento: Evento, dados: Record<string, unknown>) => void = () => undefined;
let idDoApp: () => number | undefined = () => undefined;

// ── captura ──────────────────────────────────────────────────────────────────────────────────────────────────
let vigiando = false;
const avisados = new Set<string>();
const sondados = new Set<string>();
let sondas = 0;
let opcaoAtual = '';   // opção do resolvedor que está rodando: carimba cada link (= currentOption)

function avisar(url: string, referer: string | undefined, mime: string, h: Record<string, string> | undefined) {
  if (!vigiando || bloqueado(url) || avisados.has(semQuery(url))) return;
  avisados.add(semQuery(url));
  const headers = cabecalhosDoLink(h);
  console.log(`[wm] captura: link ${mime} ${url.slice(0, 90)}${opcaoAtual ? ` (opção ${opcaoAtual})` : ''}`);
  enviarAoApp('streamFound', {
    url, mime, ...(referer ? { referer } : {}), ...(Object.keys(headers).length ? { headers } : {}),
    ...(opcaoAtual ? { option: opcaoAtual } : {}),
  });
  // A qualidade vem depois, num 2º evento que só rotula o link na lista (o link já foi pro app na hora).
  if (mime.includes('mpegurl')) {
    void net.fetch(url, { headers: headers, bypassCustomProtocolHandlers: true })
      .then((r) => r.text()).then((t) => {
        const q = qualidadeDoMaster(t);
        if (q) enviarAoApp('streamQuality', { url, quality: q });
      }).catch(() => undefined);
  }
}

/** Link que não veio do tráfego (o Blogger manda pelo console): entra igual, sem sonda e marcado como efêmero. */
function avisarDireto(url: string, quality: string, referer: string) {
  if (!vigiando) return;
  enviarAoApp('streamFound', { url, mime: 'video/mp4', quality, referer, ephemeral: true, ...(opcaoAtual ? { option: opcaoAtual } : {}) });
}

async function sondar(url: string, h: Record<string, string>, referer: string | undefined) {
  try {
    const pedido = { ...cabecalhosDoLink(h), Range: 'bytes=0-255' };
    const r = await net.fetch(url, { headers: pedido, bypassCustomProtocolHandlers: true });
    const ct = r.headers.get('content-type');
    if (tipoDeVideo(ct)) { avisar(url, referer, ct ?? mimeDe(url), h); return; }
    const comeco = new TextDecoder('latin1').decode(new Uint8Array(await r.arrayBuffer()).subarray(0, 64));
    const mime = mimePeloComeco(ct, comeco);
    if (mime) avisar(url, referer, mime, h);
  } catch { /* sonda falhou (anúncio bloqueado, servidor fora do ar): o pedido não vira link */ }
}

function inspecionar(d: PedidoVisto) {
  // Sem dono = pedido do próprio processo principal (a sonda e a qualidade daqui): nunca entra, senão vira laço.
  if (!vigiando || d.webContentsId === undefined) return;
  if (d.webContentsId !== idDoApp() && d.webContentsId !== oculta?.webContents.id) return;
  const url = d.url;
  if (bloqueado(url) || naoEConteudo(url) || /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return;
  const referer = cabecalho(d.requestHeaders, 'Referer');
  if (pareceVideo(url)) {
    avisar(url, referer, mimeDe(url), d.requestHeaders);
    if (d.webContentsId === oculta?.webContents.id) progressoDaOpcao(sessao, 'media');   // achou: segura o prazo
    return;
  }
  if (pularSonda(url) || sondas > 60 || sondados.has(semQuery(url))) return;
  sondados.add(semQuery(url));
  sondas++;
  void sondar(url, d.requestHeaders, referer);
}

// ── resolvedor ───────────────────────────────────────────────────────────────────────────────────────────────
export interface OpcoesResolvedor {
  url: string; referer?: string; hopHosts?: string[]; injectScript?: string; budgetMs?: number; optMs?: number;
  startOpt?: number; wrapIframe?: boolean;
}

let oculta: BrowserWindow | null = null;
let sessao = 0;
let script = '';
let urlInicio = '', urlAtual = '', referer = '';
let embrulhar = false;
let hopHosts: string[] = [];
let prazo: NodeJS.Timeout | null = null;
let optK = 1, optN = 0, optMs = 30000, optTentativas = 0;
let optNomes: string[] = [];
let optTimer: NodeJS.Timeout | null = null;
let optInicio = 0, optPrazoEm = 0;
const etapas = new Set<string>();
let midiaVista = false;

// Só no PC: clique de VERDADE na verificação da Cloudflare (Fontes 5/6) e na lista de servidores do player final (ela
// só aceita clique confiável: isTrusted). O APK remendava a página; aqui o script avisa onde clicar (WMCFTAP/WMCLICK)
// e o processo principal clica com o mouse da janela escondida. Só no frame principal (as coordenadas são dele).
const SCRIPT_DO_PC = '(function(){try{if(window.top!==window||window.__wmPc)return;window.__wmPc=1;var n=0,cl=0,ult=0;'
  + 'var iv=setInterval(function(){n++;if(n>60){clearInterval(iv);return;}'
  + "var s=document.querySelector('.captcha-status');var ok=s&&/conclu/i.test(s.textContent||'');"
  + "if(!ok&&n%2===0){var b=document.querySelector('.cf-turnstile-placeholder')||document.querySelector('.captcha-box');"
  + "if(b){var r=b.getBoundingClientRect();if(r.width>100&&r.height>30)console.log('WMCFTAP|'+Math.round(r.left+28)+'|'+Math.round(r.top+r.height/2)+'|'+innerWidth+'|'+innerHeight);}}"
  + "var box=typeof sfDomEl==='function'?sfDomEl('serverList'):null;"
  + "var list=box?box.querySelectorAll('a'):document.querySelectorAll('a[href=\"javascript:void(0)\"]');"
  + "for(var i=0;i<list.length;i++){var a=list[i],t=(a.textContent||'').trim();if(/download|voltar/i.test(t))continue;"
  + "if((box&&box.contains(a))||/servidor\\s+(principal|alternativo)/i.test(t)){var q=a.getBoundingClientRect();"
  + "if(q.width>2&&q.height>2&&cl<3&&Date.now()-ult>5000){cl++;ult=Date.now();console.log('WMCLICK|'+Math.round(q.left+q.width/2)+'|'+Math.round(q.top+q.height/2)+'|'+innerWidth+'|'+innerHeight);}return;}}"
  + "var msg=box&&!box.querySelector('a')?String(box.innerText||'').trim():'';"
  + "if(msg){clearInterval(iv);console.log('WMOPT|none|reason='+(/foi poss/i.test(msg)?'f56-erro-servidores':'f56-sem-servidor')+'|host='+location.hostname);}"
  + '},1600);}catch(_){}})();';

const scriptDaOpcao = () => script.split('__OPT_K__').join(String(optK)) + SCRIPT_DO_PC;

function emitir(type: string, extra: Record<string, unknown> = {}) {
  if (type !== 'loaded') console.log(`[wm] busca: ${type} ${JSON.stringify(extra).slice(0, 120)} @ ${urlAtual.slice(0, 70)}`);
  enviarAoApp('resolverEvent', { type, url: urlAtual, hops: 0, ...extra });
}

function nomeDaOpcao(): string { return optNomes[optK - 1] ?? ''; }

function emitirOpcao() {
  opcaoAtual = nomeDaOpcao();
  emitir('option', { k: optK, n: optN, name: opcaoAtual, names: optNomes });
}

function limparTimers() {
  if (prazo) { clearTimeout(prazo); prazo = null; }
  if (optTimer) { clearTimeout(optTimer); optTimer = null; }
}

function parar() {
  sessao++;
  limparTimers();
  opcaoAtual = '';
  const j = oculta;
  oculta = null;
  if (j && !j.isDestroyed()) j.destroy();
}

function carregar() {
  if (!oculta) return;
  if (embrulhar) {
    void oculta.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(paginaComIframe(urlInicio))}`,
      { baseURLForDataURL: referer || 'https://localhost/' }).catch(() => undefined);
  } else {
    void oculta.loadURL(urlInicio, referer ? { httpReferrer: referer } : {}).catch(() => undefined);
  }
}

function armarOpcao(ms: number) {
  if (optTimer) clearTimeout(optTimer);
  const s = sessao;
  optTimer = setTimeout(() => avancarOpcao(s, false), ms);
  optPrazoEm = Date.now() + ms;
}

function iniciar(o: OpcoesResolvedor) {
  parar();
  console.log(`[wm] busca: começa ${o.url.slice(0, 90)} (prazo ${o.budgetMs ?? 45000} ms, script ${(o.injectScript ?? '').length} letras)`);
  const s = sessao;
  urlInicio = urlAtual = o.url;
  referer = o.referer ?? '';
  script = o.injectScript ?? '';
  embrulhar = !!o.wrapIframe;
  hopHosts = (o.hopHosts ?? []).map((h) => h.toLowerCase());
  optMs = o.optMs ?? 30000;
  optK = Math.max(1, o.startOpt ?? 1);
  optN = 0; optNomes = []; optTentativas = 0; etapas.clear(); midiaVista = false; opcaoAtual = '';
  oculta = new BrowserWindow({
    show: false, width: 1280, height: 720, title: 'WatchMov · busca',
    webPreferences: {
      preload: path.join(__dirname, 'captura-preload.js'), contextIsolation: true, sandbox: true,
      nodeIntegrationInSubFrames: true,   // o preload (e o script do site) entra em todo iframe, como no Android
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const wc = oculta.webContents;
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));   // popup = propaganda
  wc.on('will-navigate', (e) => { if (!navegacaoPermitida(e.url, urlAtual, hopHosts)) e.preventDefault(); });
  wc.on('did-navigate', (_e, url) => { if (s === sessao) urlAtual = url; });
  wc.on('did-finish-load', () => { if (s === sessao) emitir('loaded'); });
  wc.on('console-message', (e: unknown, ...resto: unknown[]) => {
    const ev = e as { message?: unknown };
    const msg = typeof ev?.message === 'string' ? ev.message : (typeof resto[1] === 'string' ? resto[1] : '');
    if (msg) recado(s, msg);
  });
  wc.on('render-process-gone', () => { if (s === sessao) { emitir('timeout'); parar(); } });
  carregar();
  prazo = setTimeout(() => { if (s === sessao) { emitir('timeout'); parar(); } }, o.budgetMs ?? 45000);
}

function clicar(msg: string) {
  if (!oculta) return;
  const [largura, altura] = oculta.getContentSize();
  const p = pontoDoClique(msg, largura, altura);
  if (!p) return;
  const wc = oculta.webContents;
  wc.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  setTimeout(() => { if (oculta) oculta.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); }, 60);
}

// Console da janela escondida (todos os frames) = os recados do script do site (= handleConsole).
function recado(s: number, msg: string) {
  if (s !== sessao) return;
  if (/^WM(OPT|BLOG|INJ|CFTAP|CLICK)/.test(msg)) console.log(`[wm] recado: ${msg.slice(0, 110)}`);
  if (msg.startsWith('WMCFTAP|') || msg.startsWith('WMCLICK|')) { clicar(msg); return; }
  if (msg.startsWith('WMBLOG|')) {
    let corpo = msg.slice(7), q = '360p';
    if (corpo.startsWith('q=')) {
      const barra = corpo.indexOf('|');
      if (barra < 0) return;
      q = corpo.slice(2, barra);
      corpo = corpo.slice(barra + 1);
    }
    if (corpo.startsWith('url=http')) avisarDireto(corpo.slice(4), q, urlAtual);
    return;
  }
  if (!msg.startsWith('WMOPT|')) return;
  const corpo = msg.slice(6);
  if (corpo.startsWith('skip|')) { avancarOpcao(s, true); return; }
  if (corpo.startsWith('progress|') || corpo.startsWith('dead|')) {
    const morta = corpo.startsWith('dead|');
    const resto = corpo.slice(morta ? 5 : 9);
    if (kDoRecado(resto) !== optK) return;   // recado atrasado de outra opção
    if (morta) { if (optTimer && !midiaVista) avancarOpcao(s, true); }
    else progressoDaOpcao(s, `${campo(resto, 'stage') ?? ''}@${campo(resto, 'host') ?? ''}`);
    return;
  }
  if (corpo.startsWith('none|')) {
    // A fonte disse que não tem o título: acaba a busca na hora (vídeo já visto = recado tarde, não vale).
    if (midiaVista) return;
    emitir('none', { reason: campo(corpo.slice(5), 'reason') ?? '' });
    parar();
    return;
  }
  if (!corpo.startsWith('n=')) return;   // filtered|, probe|: só diagnóstico
  const [nParte, nomes] = corpo.split('|names=', 2);
  const n = Number.parseInt(nParte.slice(2), 10);
  if (!Number.isFinite(n) || n <= 0 || !oculta) return;
  optN = n;
  optNomes = nomes ? nomes.split('»') : [];
  emitirOpcao();
  if (!optTimer) {
    if (prazo) { clearTimeout(prazo); prazo = null; }   // o ciclo de opções controla o fim
    optInicio = Date.now();
    armarOpcao(optMs);
  }
}

// Player/gate apareceu ou o vídeo passou pela rede: o fim da opção vai pra agora + optMs (até 90 s desde que ela
// começou; a etapa "media" passa do teto, porque achou).
function progressoDaOpcao(s: number, etapa: string) {
  if (s !== sessao || !oculta) return;
  if (etapa === 'media') midiaVista = true;
  if (!optTimer || etapas.has(etapa)) return;
  etapas.add(etapa);
  const agora = Date.now();
  let ate = agora + optMs;
  if (!etapa.startsWith('media')) ate = Math.min(ate, optInicio + OPCAO_MAX_MS);
  if (ate > optPrazoEm) armarOpcao(ate - agora);
}

// A opção não achou vídeo (ou o script disse que não dá): a próxima; todas falharam → timeout (o app mostra a lista).
function avancarOpcao(s: number, pulada: boolean) {
  if (s !== sessao || !oculta) return;
  if (optTimer) { clearTimeout(optTimer); optTimer = null; }
  if (!pulada && midiaVista) return;   // achou o vídeo: o app abre o player, não recarrega por baixo
  etapas.clear(); midiaVista = false;
  optTentativas++;
  if (optTentativas < optN) {
    optK = (optK % optN) + 1;
    emitirOpcao();
    carregar();
    optInicio = Date.now();
    armarOpcao(optMs);
  } else {
    emitir('timeout');
    parar();
  }
}

function escolherOpcao(k: number) {
  if (!oculta || optN <= 0) return;
  optK = Math.max(1, Math.min(k, optN));
  optTentativas = 0; etapas.clear(); midiaVista = false;
  emitirOpcao();
  carregar();
  if (optTimer) { optInicio = Date.now(); armarOpcao(optMs); }
}

/** Liga a captura e o resolvedor. `janelaApp` = a janela do site (recebe os eventos e só ela pode pedir). */
export function ligarCaptura(janelaApp: () => BrowserWindow | null): void {
  idDoApp = () => janelaApp()?.webContents.id;
  enviarAoApp = (evento, dados) => {
    const j = janelaApp();
    if (j && !j.isDestroyed()) j.webContents.send('wm:captura', evento, dados);
  };
  aoPedido(inspecionar);
  const doApp = (e: Electron.IpcMainInvokeEvent) => e.sender.id === idDoApp();

  ipcMain.handle('wm:sniffer', (e, ligar: unknown) => {
    if (!doApp(e)) return false;
    vigiando = ligar === true;
    console.log(`[wm] captura: ${vigiando ? 'ligada' : 'desligada'}`);
    if (vigiando) { avisados.clear(); sondados.clear(); sondas = 0; }
    return true;
  });
  ipcMain.handle('wm:resolver-iniciar', (e, o: unknown) => {
    const op = o as OpcoesResolvedor;
    if (!doApp(e) || !op || typeof op.url !== 'string' || !/^https?:\/\//.test(op.url)) return false;
    iniciar(op);
    return true;
  });
  ipcMain.handle('wm:resolver-parar', (e) => { if (doApp(e)) parar(); return true; });
  ipcMain.handle('wm:resolver-opcao', (e, k: unknown) => { if (doApp(e) && typeof k === 'number') escolherOpcao(k); return true; });
  // O preload da janela escondida pede o script da opção atual, em cada frame, antes da página rodar.
  ipcMain.on('wm:captura-frame', (_e, href: unknown, como: unknown) => console.log(`[wm] busca: script não entrou em ${String(href).slice(0, 80)} (${String(como)})`));
  ipcMain.on('wm:captura-script', (e) => { e.returnValue = oculta && e.sender.id === oculta.webContents.id ? scriptDaOpcao() : ''; });
}

/** Recurso que a janela escondida não carrega (o rede.ts cancela antes de sair). */
export function derrubarNaBusca(webContentsId: number | undefined, url: string): boolean {
  return webContentsId !== undefined && webContentsId === oculta?.webContents.id && derrubar(url);
}
