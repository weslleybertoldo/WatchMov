// Ponte do app do Windows: o que a interface (src/lib/desktop.ts) pode pedir ao processo principal.
// Só a página do app recebe a ponte; os iframes dos servidores de vídeo não.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

let chave = '';
const chaveVideo = (): string => {
  if (!chave) { try { chave = String(ipcRenderer.sendSync('wm:video-chave') ?? ''); } catch { /* sem chave: o vídeo não abre pelo app */ } }
  return chave;
};

contextBridge.exposeInMainWorld('wmDesktop', {
  abrirFora: (url: string): Promise<boolean> => ipcRenderer.invoke('wm:abrir-fora', url),
  linkPendente: (): Promise<string | null> => ipcRenderer.invoke('wm:link-pendente'),
  aoAbrirLink: (cb: (url: string) => void): (() => void) => {
    const ouvir = (_e: IpcRendererEvent, url: string) => cb(url);
    ipcRenderer.on('wm:deep-link', ouvir);
    return () => { ipcRenderer.off('wm:deep-link', ouvir); };
  },
  // Aviso do Windows clicado (sino, W6, v5.29+): traz a janela pra frente.
  focar: (): Promise<boolean> => ipcRenderer.invoke('wm:focar'),
  // Quedas do app (falhas.ts, v5.29+): o que a aba Bugs ainda não recebeu, no formato do AppExitLog do APK.
  falhas: {
    pendentes: (): Promise<unknown[]> => ipcRenderer.invoke('wm:falhas-pendentes'),
    confirmar: (ts: number): Promise<boolean> => ipcRenderer.invoke('wm:falhas-confirmar', ts),
  },
  // Rede de app (rede.ts): cabeçalhos que o servidor usou, repetidos nos pedidos da página ao mesmo host.
  rede: {
    cabecalhos: (url: string, cabecalhos: Record<string, string>): Promise<boolean> =>
      ipcRenderer.invoke('wm:rede-cabecalhos', url, cabecalhos),
    estado: (): Promise<unknown> => ipcRenderer.invoke('wm:rede-estado'),
    // Cabeçalhos do link que o player do app está tocando (todo pedido de mídia da página leva); null = parou.
    reproducao: (cabecalhos: Record<string, string> | null): Promise<boolean> =>
      ipcRenderer.invoke('wm:rede-reproducao', cabecalhos),
    // Endereço do vídeo pelo app (desktop/regras.ts, alvoDoVideo; o preload em sandbox não importa arquivo): o hls.js
    // do player busca a playlist e os pedaços por aqui. A chave só chega na página do app (iframe não tem preload).
    videoPeloApp: (url: string): string => `wm-video://v/?t=${chaveVideo()}&u=${encodeURIComponent(url)}`,
  },
  // Abrir sozinho (captura.ts, v5.23+): captura do link e resolvedor na janela escondida, com os eventos do Android.
  captura: {
    sniffer: (ligar: boolean): Promise<boolean> => ipcRenderer.invoke('wm:sniffer', ligar),
    resolverIniciar: (o: unknown): Promise<boolean> => ipcRenderer.invoke('wm:resolver-iniciar', o),
    resolverParar: (): Promise<boolean> => ipcRenderer.invoke('wm:resolver-parar'),
    resolverOpcao: (k: number): Promise<boolean> => ipcRenderer.invoke('wm:resolver-opcao', k),
    aoEvento: (cb: (evento: string, dados: unknown) => void): (() => void) => {
      const ouvir = (_e: IpcRendererEvent, evento: string, dados: unknown) => cb(evento, dados);
      ipcRenderer.on('wm:captura', ouvir);
      return () => { ipcRenderer.off('wm:captura', ouvir); };
    },
  },
  // Downloads (downloads.ts, v5.27+): os mesmos métodos e eventos do Downloader do APK; o arquivo baixado toca pelo
  // esquema do vídeo (wm-video://arquivo/…), com a mesma chave que só a página do app recebe.
  downloads: {
    enfileirar: (o: unknown): Promise<boolean> => ipcRenderer.invoke('wm:dl-enfileirar', o),
    remover: (key: string): Promise<boolean> => ipcRenderer.invoke('wm:dl-remover', key),
    lista: (): Promise<unknown[]> => ipcRenderer.invoke('wm:dl-lista'),
    retomar: (): Promise<boolean> => ipcRenderer.invoke('wm:dl-retomar'),
    espaco: (): Promise<unknown> => ipcRenderer.invoke('wm:dl-espaco'),
    arquivo: (key: string): string => `wm-video://arquivo/?t=${chaveVideo()}&k=${encodeURIComponent(key)}`,
    aoEvento: (cb: (evento: string, dados: unknown) => void): (() => void) => {
      const ouvir = (_e: IpcRendererEvent, evento: string, dados: unknown) => cb(evento, dados);
      ipcRenderer.on('wm:downloads', ouvir);
      return () => { ipcRenderer.off('wm:downloads', ouvir); };
    },
  },
  // Pasta dos downloads (downloads.ts, v5.29+): a atual e a troca pela janela de pastas do Windows.
  pastaDownloads: {
    atual: (): Promise<string> => ipcRenderer.invoke('wm:dl-pasta'),
    trocar: (): Promise<string | null> => ipcRenderer.invoke('wm:dl-trocar-pasta'),
  },
  // Mandar pra TV (cast.ts, v5.28+): DLNA e Chromecast da rede da casa (o PC serve o vídeo pra TV) e o Transmitir do
  // Windows. Eventos: estado (1 por segundo), fim, erro, parou.
  cast: {
    procurar: (): Promise<unknown[]> => ipcRenderer.invoke('wm:cast-procurar'),
    enviar: (o: unknown): Promise<unknown> => ipcRenderer.invoke('wm:cast-enviar', o),
    controle: (acao: string, valor?: number): Promise<boolean> => ipcRenderer.invoke('wm:cast-controle', acao, valor),
    estado: (): Promise<unknown> => ipcRenderer.invoke('wm:cast-estado'),
    parar: (): Promise<unknown> => ipcRenderer.invoke('wm:cast-parar'),
    espelhar: (): Promise<boolean> => ipcRenderer.invoke('wm:cast-espelhar'),
    aoEvento: (cb: (evento: string, dados: unknown) => void): (() => void) => {
      const ouvir = (_e: IpcRendererEvent, evento: string, dados: unknown) => cb(evento, dados);
      ipcRenderer.on('wm:cast', ouvir);
      return () => { ipcRenderer.off('wm:cast', ouvir); };
    },
  },
});
