// WatchMov para Windows (Electron). A janela abre o SITE de verdade (https://watchmovbr.vercel.app), igual ao navegador:
// os servidores de vídeo conferem quem os abre e, com a interface empacotada no instalador (https interceptado aqui no
// processo principal), mostravam uma página falsa no lugar do vídeo (teste de 07/11/2026; com o site direto, o mesmo
// título tocou). O que o navegador não faz passa pela ponte (preload.ts → window.wmDesktop; src/lib/desktop.ts): o
// login do Google pelo navegador do PC e a rede de app (rede.ts: DNS próprio, cabeçalhos/CORS do vídeo, sem
// propaganda). Funções novas da ponte são opcionais no site (o .exe que ainda não atualizou não as tem).
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { ligarRede, protegerJanela } from './rede';

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
    ligarRede(ORIGEM);
    abrirJanela();
    // Atualização: baixa a versão nova da release do GitHub e instala ao fechar (avisa pelo Windows).
    if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch((e: unknown) => console.warn('[wm] atualização:', e));
  });
  app.on('window-all-closed', () => app.quit());
}
