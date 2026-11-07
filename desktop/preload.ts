// Ponte do app do Windows: o que a interface (src/lib/desktop.ts) pode pedir ao processo principal.
// Só a página do app recebe a ponte; os iframes dos servidores de vídeo não.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

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
  },
});
