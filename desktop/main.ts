// WatchMov para Windows (Electron). A janela abre o SITE de verdade (https://watchmovbr.vercel.app), igual ao navegador:
// os servidores de vídeo conferem quem os abre e, com a interface empacotada no instalador (https interceptado aqui no
// processo principal), mostravam uma página falsa no lugar do vídeo (teste de 07/11/2026; com o site direto, o mesmo
// título tocou). O que o navegador não faz passa pela ponte (preload.ts → window.wmDesktop; src/lib/desktop.ts): o
// login do Google pelo navegador do PC e a rede de app (rede.ts: DNS próprio, cabeçalhos/CORS do vídeo, sem
// propaganda). Funções novas da ponte são opcionais no site (o .exe que ainda não atualizou não as tem).
import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { aoBloquear, ligarRede, protegerJanela, registrarEsquemaVideo } from './rede';
import { derrubarNaBusca, ligarCaptura } from './captura';
import { ligarDownloads, pararDownloads } from './downloads';

const SITE = 'https://watchmovbr.vercel.app/';
// Retorno do login do Google (src/lib/capacitorAuth.ts, REDIRECT_SCHEME): o mesmo do APK, que o Supabase já aceita.
const ESQUEMA = 'com.weslley.watchmov';

// Teste: WM_SITE troca o site (instalado: só os da Vercel do WatchMov, ex. o staging; desenvolvimento: qualquer um).
function siteDoApp(): string {
  const pedido = process.env.WM_SITE;
  if (!pedido) return SITE;
  if (!app.isPackaged) return pedido;
  return /^https:\/\/watchmov[a-z0-9-]*\.vercel\.app\/$/.test(pedido) ? pedido : SITE;
}
const INICIO = siteDoApp();
const ORIGEM = new URL(INICIO).origin;

let janela: BrowserWindow | null = null;
let linkPendente: string | null = null;

// Sem internet (W4): o site não abre, então a janela abre a cópia que o service worker do app guardou (public/sw-desktop.js;
// ele só responde a página com ?offline=1) e dá pra assistir o que foi baixado. Erros de rede do Chromium:
// INTERNET_DISCONNECTED, NAME_NOT_RESOLVED, CONNECTION_*, TIMED_OUT, ADDRESS_UNREACHABLE, NETWORK_CHANGED…
const SEM_REDE = new Set([-7, -15, -21, -100, -101, -102, -104, -105, -106, -109, -118, -130, -137, -324]);
const SEM_INTERNET = (() => { const u = new URL(INICIO); u.searchParams.set('offline', '1'); return u.toString(); })();
let vigiaDaVolta: NodeJS.Timeout | null = null;

function abrirSemInternet(descricao: string) {
  if (!janela) return;
  // Sem rede de verdade no PC (cabo/Wi-Fi): quando ela voltar, o site abre de novo sozinho. Com rede e o site fora (DNS,
  // portal de Wi-Fi), fica na cópia até o app ser aberto de novo.
  const semRedeNoPc = !net.isOnline();
  console.log(`[wm] sem internet (${descricao}${semRedeNoPc ? ', PC sem rede' : ''}): abre a cópia guardada do app (downloads)`);
  void janela.loadURL(SEM_INTERNET);
  if (vigiaDaVolta || !semRedeNoPc) return;
  // A internet voltou: abre o site de novo (a cópia guardada não tem a CSP do app), mas não no meio de um vídeo.
  vigiaDaVolta = setInterval(() => {
    if (!janela || !net.isOnline()) return;
    void janela.webContents.executeJavaScript('!!document.querySelector("[data-wm-player-desktop]")').then((tocando) => {
      if (tocando || !janela) return;
      void net.fetch(INICIO, { method: 'HEAD', cache: 'no-store' }).then((r) => {
        if (!r.ok || !janela || !vigiaDaVolta) return;
        clearInterval(vigiaDaVolta); vigiaDaVolta = null;
        console.log('[wm] a internet voltou: abre o site');
        void janela.loadURL(INICIO);
      }).catch(() => undefined);
    }).catch(() => undefined);
  }, 15_000);
}

function semCopiaGuardada() {
  if (!janela) return;
  const html = `<!doctype html><meta charset="utf-8"><title>WatchMov</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#ddd;font:16px system-ui,sans-serif;text-align:center"><div><p style="font-size:20px;color:#fff">Sem internet</p><p>O WatchMov precisa da internet na primeira vez que abre.<br>Conecte o PC e abra o app de novo.</p></div>`;
  void janela.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

const linkDoLogin = (argv: string[]): string | null => argv.find((a) => a.startsWith(`${ESQUEMA}://`)) ?? null;

// Os servidores de vídeo veem um Chrome comum (sem "Electron/…" nem o nome do app no user agent).
app.userAgentFallback = app.userAgentFallback.replace(/\s(?:Electron|WatchMov|watchmov-desktop)\/\S+/gi, '');

function abrirJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'WatchMov',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { preload: `${__dirname}/preload.js`, contextIsolation: true, sandbox: true },
  });
  janela.once('ready-to-show', () => janela?.show());
  // Janela nova só da própria página (no navegador do PC); propaganda dos servidores não abre nada nem troca a página.
  protegerJanela(janela.webContents, ORIGEM);
  janela.on('closed', () => { janela = null; });
  janela.webContents.on('did-fail-load', (_e, codigo, descricao, url, principal) => {
    if (!principal || !SEM_REDE.has(codigo)) return;
    if (url.startsWith(SEM_INTERNET)) semCopiaGuardada();   // 1ª abertura sem internet: não há cópia guardada
    else if (url.startsWith(ORIGEM)) abrirSemInternet(descricao);
  });
  void janela.loadURL(INICIO);
}

// Link do login que chega com o app aberto (o Windows abre uma 2ª cópia com o link; ela passa pra esta e sai).
function receberLink(url: string | null) {
  if (!url) return;
  if (janela && !janela.webContents.isLoading()) janela.webContents.send('wm:deep-link', url);
  else linkPendente = url;
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  linkPendente = linkDoLogin(process.argv); // app aberto PELO link, com ele fechado
  registrarEsquemaVideo();   // o vídeo do player do app (wm-video://); o Electron exige antes do `ready`
  app.setAppUserModelId(ESQUEMA);
  if (app.isPackaged) app.setAsDefaultProtocolClient(ESQUEMA);
  app.on('second-instance', (_e, argv) => receberLink(linkDoLogin(argv)));

  ipcMain.handle('wm:abrir-fora', async (_e, url: unknown) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('wm:link-pendente', () => {
    const url = linkPendente;
    linkPendente = null;
    return url;
  });

  void app.whenReady().then(() => {
    ligarRede(ORIGEM);
    // Abrir sozinho (W2): captura do link + resolvedor na janela escondida; os eventos vão só pra janela do app.
    aoBloquear(derrubarNaBusca);
    ligarCaptura(() => janela);
    // Downloads (W4): .mp4 em Vídeos\WatchMov, os eventos vão só pra janela do app; o que ficou pela metade continua.
    ligarDownloads(ORIGEM, () => janela);
    abrirJanela();
    // Atualização: baixa a versão nova da release do GitHub e instala ao fechar (avisa pelo Windows).
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => console.warn('[wm] atualização:', e));
  });
  app.on('before-quit', () => pararDownloads());
  app.on('window-all-closed', () => app.quit());
}
