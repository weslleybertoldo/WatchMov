// WatchMov para Windows (Electron). A janela abre o SITE de verdade (https://watchmovbr.vercel.app), igual ao navegador:
// os servidores de vídeo conferem quem os abre e, com a interface empacotada no instalador (https interceptado aqui no
// processo principal), mostravam uma página falsa no lugar do vídeo (teste de 07/11/2026; com o site direto, o mesmo
// título tocou). O que o navegador não faz passa pela ponte (preload.ts → window.wmDesktop; src/lib/desktop.ts):
// por enquanto, o login do Google pelo navegador do PC. Funções novas da ponte são opcionais no site (o .exe que ainda
// não atualizou não as tem).
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';

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
const doApp = (url: string): boolean => {
  try { return new URL(url).origin === ORIGEM; } catch { return false; }
};

let janela: BrowserWindow | null = null;
let linkPendente: string | null = null;

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
  // Janela nova: só a do próprio app abre, e no navegador do PC. Propaganda dos servidores (iframes) não abre nada.
  janela.webContents.setWindowOpenHandler(({ url, referrer }) => {
    if (doApp(referrer.url) && /^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // A janela principal nunca sai do app: endereço de fora vai pro navegador do PC.
  janela.webContents.on('will-navigate', (e, url) => {
    if (doApp(url)) return;
    e.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });
  janela.on('closed', () => { janela = null; });
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
    abrirJanela();
    // Atualização: baixa a versão nova da release do GitHub e instala ao fechar (avisa pelo Windows).
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => console.warn('[wm] atualização:', e));
  });
  app.on('window-all-closed', () => app.quit());
}
