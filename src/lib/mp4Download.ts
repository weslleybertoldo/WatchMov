import { registerPlugin, Capacitor } from '@capacitor/core';
import { toast } from 'sonner';

// Opção "baixar já em MP4" (plugin Mp4Download). Grava um arquivo real em
// Movies/WatchMov enquanto baixa — qualquer app abre (Web Video Cast, VLC,
// galeria) e a TV toca. Em troca, não retoma se cair: o MP4 só fecha no fim.
// O download padrão (Media3) segue intacto em downloads.ts.

export interface Mp4Event {
  key: string;
  state: 'downloading' | 'done' | 'failed' | 'canceled' | 'removed';
  percent: number;   // -1 enquanto não dá pra estimar
  name?: string;
  uri?: string;
  error?: string;
}

interface Mp4DownloadPlugin {
  start(o: { key: string; url: string; referer?: string; mime?: string; title?: string }): Promise<void>;
  cancel(): Promise<void>;
  status(o: { key: string }): Promise<{ done: boolean; uri?: string; running: boolean }>;
  openWith(o: { key: string; title?: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  addListener(event: 'mp4Changed', cb: (e: Mp4Event) => void): Promise<{ remove: () => void }>;
}

export const Mp4Download = registerPlugin<Mp4DownloadPlugin>('Mp4Download');
export const mp4Native = () => Capacitor.isNativePlatform();

let listening = false;

// Um toast só, atualizado a cada evento — sem mexer em nenhuma tela.
function listen() {
  if (listening || !mp4Native()) return;
  listening = true;
  Mp4Download.addListener('mp4Changed', e => {
    const id = `mp4-${e.key}`;
    if (e.state === 'downloading') {
      toast.loading(e.percent >= 0 ? `Baixando em MP4… ${e.percent}%` : 'Baixando em MP4…', {
        id, description: 'Deixe o app aberto — esse formato não retoma se parar.',
      });
    } else if (e.state === 'done') {
      toast.success('MP4 pronto', {
        id, description: `${e.name || 'vídeo'} em Movies/WatchMov — abra no Web Video Cast pra mandar na TV.`,
      });
    } else if (e.state === 'failed') {
      toast.error('Não consegui baixar em MP4', { id, description: e.error || 'erro' });
    } else {
      toast.dismiss(id);
    }
  }).catch(() => {});
}

export async function downloadAsMp4(key: string, o: { url: string; referer?: string; mime?: string; title?: string }) {
  if (!mp4Native()) return;
  listen();
  try {
    await Mp4Download.start({ key, ...o });
  } catch (e) {
    toast.error('Não consegui baixar em MP4', { description: (e as Error)?.message || 'erro' });
  }
}

export async function mp4Status(key: string) {
  if (!mp4Native()) return { done: false, running: false };
  try { return await Mp4Download.status({ key }); } catch { return { done: false, running: false }; }
}

export async function openMp4(key: string, title?: string) {
  if (!mp4Native()) return;
  try { await Mp4Download.openWith({ key, title }); }
  catch (e) { toast.error('Não consegui abrir', { description: (e as Error)?.message || 'erro' }); }
}

export async function removeMp4(key: string) {
  if (!mp4Native()) return;
  try { await Mp4Download.remove({ key }); } catch { /* já não existe */ }
}
