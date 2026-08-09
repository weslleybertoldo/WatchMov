import { registerPlugin, Capacitor } from '@capacitor/core';
import { useEffect, useReducer } from 'react';
import { toast } from 'sonner';

// Exportação de um download pra MP4 real em Movies/WatchMov (plugin Exporter).
// Serve pro que o proxy não resolve: mandar o vídeo BAIXADO pro Web Video Cast/VLC
// e daí pra TV (DLNA não toca HLS, e Android/data é invisível pra outros apps).

export type ExportState = 'exporting' | 'done' | 'failed' | 'removed' | 'canceled';

export interface ExportItem {
  key: string;
  state: ExportState;
  percent: number;    // 0..100, ou -1 enquanto o remux não sabe estimar
  uri?: string;       // content:// do MediaStore
  name?: string;      // "Duna - T1E4.mp4"
  error?: string;
}

interface ExporterPlugin {
  list(): Promise<{ exports: ExportItem[] }>;
  start(o: { key: string; title?: string }): Promise<void>;
  cancel(o: { key: string }): Promise<void>;
  openWith(o: { key: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
  addListener(event: 'exportChanged', cb: (e: ExportItem) => void): Promise<{ remove: () => void }>;
}

const Exporter = registerPlugin<ExporterPlugin>('Exporter');
export const exportNative = () => Capacitor.isNativePlatform();

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
const items = new Map<string, ExportItem>();
let inited = false;

function apply(e: ExportItem) {
  if (e.state === 'removed' || e.state === 'canceled') items.delete(e.key);
  else items.set(e.key, e);
  notify();
}

function ensureInit() {
  if (inited) return;
  inited = true;
  if (!exportNative()) return;
  Exporter.list().then(({ exports }) => { exports.forEach(e => items.set(e.key, e)); notify(); }).catch(() => {});
  Exporter.addListener('exportChanged', e => {
    apply(e);
    if (e.state === 'done') {
      toast.success('Vídeo exportado', { description: `${e.name} salvo em Movies/WatchMov — toque de novo pra abrir no Web Video Cast.` });
    } else if (e.state === 'failed') {
      toast.error('Não consegui exportar', { description: e.error || 'falha no remux' });
    }
  }).catch(() => {});
}

export function getExport(key: string): ExportItem | undefined { ensureInit(); return items.get(key); }

// Exporta (remux HLS→MP4). O nativo recusa se o download não estiver completo ou
// se faltar espaço — a mensagem sobe como toast.
export async function startExport(key: string, title?: string) {
  if (!exportNative()) return;
  items.set(key, { key, state: 'exporting', percent: -1 }); notify();
  try {
    await Exporter.start({ key, title });
    toast.info('Exportando…', { description: 'Convertendo pra MP4. Pode levar alguns minutos — deixe o app aberto.' });
  } catch (e) {
    items.delete(key); notify();
    toast.error('Não consegui exportar', { description: (e as Error)?.message || 'erro' });
  }
}

// Abre o seletor do sistema (Web Video Cast, VLC, MX, galeria…).
export async function openExport(key: string) {
  if (!exportNative()) return;
  try { await Exporter.openWith({ key }); }
  catch (e) { toast.error('Não consegui abrir', { description: (e as Error)?.message || 'erro' }); }
}

export async function removeExport(key: string) {
  if (!exportNative()) return;
  items.delete(key); notify();
  try { await Exporter.remove({ key }); } catch { /* já não existe */ }
}

export async function cancelExport(key: string) {
  if (!exportNative()) return;
  try { await Exporter.cancel({ key }); } catch { /* nada rodando */ }
}

// Hook reativo pro estado de exportação de uma chave.
export function useExport(key: string): ExportItem | undefined {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return items.get(key);
}

// Hook reativo pro mapa inteiro (aba Download renderiza vários itens de uma vez).
export function useExports(): Map<string, ExportItem> {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { ensureInit(); listeners.add(force); return () => { listeners.delete(force); }; }, []);
  return items;
}
