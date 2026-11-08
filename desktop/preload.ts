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
});
