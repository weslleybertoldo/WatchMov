import { registerPlugin, Capacitor } from '@capacitor/core';
import { useEffect, useReducer } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { upsertNotice } from '@/lib/appNotices';

// Opção "baixar já em MP4" (plugin Mp4Download). Grava um arquivo real em
// Movies/WatchMov enquanto baixa — qualquer app abre (Web Video Cast, VLC,
// galeria) e a TV toca. Em troca, não retoma se cair: o MP4 só fecha no fim.
// O download padrão (Media3) segue intacto em downloads.ts.

export interface Mp4Event {
  key: string;
  state: 'downloading' | 'converting' | 'queued' | 'done' | 'failed' | 'canceled' | 'removed';
  percent: number;      // -1 enquanto não dá pra estimar
  name?: string;
  uri?: string;
  error?: string;
  mode?: 'download' | 'convert';   // baixar já em MP4 x converter o que já baixou
  position?: number;    // lugar na fila (1 = próximo a rodar)
  size?: number;        // bytes do MP4 no MediaStore (0 = arquivo vazio)
}

interface Mp4DownloadPlugin {
  start(o: { key: string; url: string; referer?: string; mime?: string; title?: string }): Promise<void>;
  convert(o: { key: string; title?: string }): Promise<void>;
  list(): Promise<{ keys: string[]; running?: string; queued?: string[]; entries?: { key: string; name?: string; size?: number }[] }>;
  cancel(o?: { key?: string }): Promise<void>;
  status(o: { key: string }): Promise<{ done: boolean; uri?: string; running: boolean }>;
  openWith(o: { key: string; title?: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  addListener(event: 'mp4Changed', cb: (e: Mp4Event) => void): Promise<{ remove: () => void }>;
}

export const Mp4Download = registerPlugin<Mp4DownloadPlugin>('Mp4Download');
export const mp4Native = () => Capacitor.isNativePlatform();

// "Seus Amigos e Vizinhos — T2E9" (sem a extensão) — o nativo manda o nome do arquivo.
const nomeDe = (e: Mp4Event) => (e.name || 'vídeo').replace(/\.mp4$/i, '');

let listening = false;

// Estado por chave (a aba Download mostra o formato e o progresso da conversão).
const items = new Map<string, Mp4Event>();
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());

// Um toast só, atualizado a cada evento — sem mexer em nenhuma tela.
function listen() {
  if (listening || !mp4Native()) return;
  listening = true;
  Mp4Download.list().then(({ keys, running, queued, entries }) => {
    const info = new Map((entries || []).map(e => [e.key, e]));
    keys.forEach(k => items.set(k, { key: k, state: 'done', percent: 100, name: info.get(k)?.name, size: info.get(k)?.size }));
    (queued || []).forEach(k => items.set(k, { key: k, state: 'queued', percent: -1 }));
    if (running) items.set(running, { key: running, state: 'converting', percent: -1 });
    notify();
  }).catch(() => {});
  Mp4Download.addListener('mp4Changed', e => {
    const antes = items.get(e.key)?.state;
    if (e.state === 'canceled' || e.state === 'removed' || e.state === 'failed') items.delete(e.key);
    else items.set(e.key, e);
    notify();
    const id = `mp4-${e.key}`;
    if (e.state === 'canceled') { upsertNotice(`mp4:${e.key}`, { kind: e.mode === 'download' ? 'download' : 'mp4', title: `Cancelado: ${nomeDe(e)}`, body: 'O que já estava baixado continua no aparelho.' }); toast.dismiss(id); return; }
    if (e.state === 'queued') {
      // Toast COM saída (o loading ficava preso na tela); o registro fica no sino.
      toast.info('Na fila…', { id, duration: 4000, description: 'Começa assim que a conversão atual terminar.' });
      upsertNotice(`mp4:${e.key}`, { kind: e.mode === 'download' ? 'download' : 'mp4',
        title: `${e.position ? `${e.position}º na fila` : 'Na fila'}: ${nomeDe(e)}`,
        body: 'Começa assim que a atual terminar.' });
      return;
    }
    if (e.state === 'converting') {
      // Aviso SÓ ao começar, com saída. O acompanhamento ao vivo fica no sino
      // (aba Conversões) e na notificação do Android — um toast que nunca some
      // tapa a tela inteira enquanto a conversão dura.
      if (antes !== 'converting') {
        toast.info('Convertendo pra MP4…', { id, duration: 4000, description: 'Acompanhe no sino ou na notificação. Pode fechar o app.' });
        upsertNotice(`mp4:${e.key}`, { kind: 'mp4', title: `Convertendo ${nomeDe(e)}`, body: 'Acompanhe o progresso aqui.' });
      }
      return;
    }
    if (e.state === 'downloading') {
      if (antes !== 'downloading') {
        toast.info('Baixando em MP4…', { id, duration: 4000, description: 'Acompanhe no sino ou na notificação; se parar no meio, recomeça do zero.' });
        upsertNotice(`mp4:${e.key}`, { kind: 'download', title: `Baixando ${nomeDe(e)} em MP4`, body: 'Acompanhe o progresso aqui.' });
      }
    } else if (e.state === 'done') {
      toast.success('MP4 pronto', {
        id, duration: 6000,
        description: `${e.name || 'vídeo'} em Movies/WatchMov — abra no Web Video Cast pra mandar na TV.`,
      });
      // Substitui o aviso de progresso desta mesma tarefa.
      const baixou = (e.mode ?? (antes === 'downloading' ? 'download' : 'convert')) === 'download';
      upsertNotice(`mp4:${e.key}`, { kind: baixou ? 'download' : 'mp4',
        title: `${baixou ? 'Download' : 'Conversão'} de ${nomeDe(e)} concluído (MP4)`,
        body: 'Está em Movies/WatchMov — dá pra abrir no Web Video Cast ou VLC.' });
    } else if (e.state === 'failed') {
      toast.error('Não consegui baixar em MP4', { id, duration: 8000, description: e.error || 'erro' });
      const eraDownload = (e.mode ?? (antes === 'downloading' ? 'download' : 'convert')) === 'download';
      upsertNotice(`mp4:${e.key}`, { kind: eraDownload ? 'download' : 'mp4', error: true,
        title: `${eraDownload ? 'O download em MP4' : 'A conversão'} de ${nomeDe(e)} falhou`,
        body: e.error || 'erro' });
      // Vai pro painel de bugs mesmo com o player fechado (o log do player só
      // registra enquanto ele está montado — foi por isso que o 1º erro se perdeu).
      supabase.from('wm_playback_errors').insert({
        title: e.name ?? e.key,
        error_name: 'EXPORT_MP4',
        error_cause: e.error ?? null,
        app_version: __APP_VERSION__,
        platform: 'android',
      }).then(({ error }) => { if (error) console.warn('[bugs] log export falhou', error.message); });
    } else {
      toast.dismiss(id);
    }
  }).catch(() => {});
}

// Liga o acompanhamento (toasts + central) já no boot: a conversão pode começar
// pelo botão do player nativo, sem nenhuma tela do JS montada.
export function startMp4Listener() { listen(); }

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

// Cancela a conversão/baixa em MP4 dessa chave (se estiver na fila, só sai dela).
export async function cancelMp4(key: string) {
  if (!mp4Native()) return;
  items.delete(key); notify();
  try { await Mp4Download.cancel({ key }); } catch { /* nada rodando */ }
}

export async function removeMp4(key: string) {
  if (!mp4Native()) return;
  try { await Mp4Download.remove({ key }); } catch { /* já não existe */ }
}

// Converte um título JÁ BAIXADO (cache do Media3) pra MP4 — mesmo motor do botão
// do player, chamado pela aba Download.
export async function convertToMp4(key: string, title?: string) {
  if (!mp4Native()) return;
  listen();
  items.set(key, { key, state: 'converting', percent: -1 }); notify();
  try {
    await Mp4Download.convert({ key, title });
  } catch (e) {
    items.delete(key); notify();
    toast.error('Não consegui converter', { description: (e as Error)?.message || 'erro' });
  }
}

/** Nome do arquivo MP4 de cada chave pronta — único título de um MP4 baixado
 *  antes do registro de metadata existir. */
export function mp4Names(): Map<string, string> {
  listen();
  const out = new Map<string, string>();
  items.forEach((v, k) => { if (v.state === 'done' && v.name) out.set(k, v.name.replace(/\.mp4$/i, '')); });
  return out;
}

/** Chaves que já têm MP4 pronto (o app trata como BAIXADO, igual ao cache Media3). */
export function mp4DoneKeys(): Set<string> {
  listen();
  const out = new Set<string>();
  items.forEach((v, k) => { if (v.state === 'done') out.add(k); });
  return out;
}

/** Onde está o MP4 dessa chave (content:// do MediaStore), pra reproduzir. */
export async function mp4UriOf(key: string): Promise<string | null> {
  if (!mp4Native()) return null;
  try { const r = await Mp4Download.status({ key }); return r.done ? (r.uri ?? null) : null; } catch { return null; }
}

/** Avisa a UI quando a lista de MP4 muda (a aba Download escuta pra atualizar). */
export function onMp4Change(cb: () => void): () => void {
  listen(); subs.add(cb); return () => { subs.delete(cb); };
}

// Hook reativo com TUDO: a aba Conversões do sino lista o que está em andamento.
export function useMp4All(): Mp4Event[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listen(); subs.add(force); return () => { subs.delete(force); }; }, []);
  return [...items.values()];
}

// Hook reativo por chave: undefined = só cache (.exo); 'done' = tem MP4.
export function useMp4(key: string): Mp4Event | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { listen(); subs.add(force); return () => { subs.delete(force); }; }, []);
  return items.get(key);
}
