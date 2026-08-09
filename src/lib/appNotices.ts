import { useEffect, useReducer } from 'react';

// Central de avisos do app (o sino no topo). Os toasts passam e somem; aqui fica o
// registro — download concluído, MP4 pronto, conversão na fila ou falhada.
// Guardado em localStorage: funciona offline e sobrevive ao fechar o app.

// Uma aba por tipo na tela do sino: lançamentos, downloads e conversões.
export type NoticeKind = 'release' | 'download' | 'mp4';

export interface Notice {
  id: string;
  at: number;          // epoch ms
  kind: NoticeKind;
  title: string;
  body?: string;
  error?: boolean;     // falhou (aparece na aba do tipo, marcado em vermelho)
  read?: boolean;
  ref?: string;        // mesma tarefa (ex. "mp4:e:123:2:5") → o aviso é SUBSTITUÍDO
}

const KEY = 'watchmov_notices';
const MAX = 60;        // histórico curto: é aviso, não log

const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());

function read(): Notice[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list: Notice[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* cota cheia */ }
  notify();
}

export function addNotice(n: { kind: NoticeKind; title: string; body?: string; error?: boolean }) {
  const list = read();
  const at = Date.now();
  // Mesmo aviso repetido em sequência (ex. reenvio do evento) não duplica.
  if (list[0] && list[0].title === n.title && list[0].body === n.body && at - list[0].at < 15000) return;
  write([{ id: `${at}-${Math.round(Math.random() * 1e6)}`, at, read: false, ...n }, ...list]);
}

/**
 * Aviso da MESMA tarefa: substitui o anterior em vez de empilhar. "Convertendo X"
 * vira "Conversão de X concluída" na mesma linha — sem deixar um progresso morto
 * no histórico.
 */
export function upsertNotice(ref: string, n: { kind: NoticeKind; title: string; body?: string; error?: boolean }) {
  const list = read().filter(x => x.ref !== ref);
  const at = Date.now();
  write([{ id: `${ref}-${at}`, at, read: false, ref, ...n }, ...list]);
}

export function getNotices(): Notice[] { return read(); }
export function unreadCount(): number { return read().filter(n => !n.read).length; }
export function markAllRead() { write(read().map(n => ({ ...n, read: true }))); }
export function clearNotices() { write([]); }

export function useNotices(): { list: Notice[]; unread: number } {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { subs.add(force); return () => { subs.delete(force); }; }, []);
  const list = read();
  return { list, unread: list.filter(n => !n.read).length };
}

// "agora", "há 5 min", "ontem 21:40" — o suficiente pra situar o aviso.
export function noticeWhen(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  const d = new Date(at);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  if (mesmoDia) return hhmm;
  const ontem = new Date(Date.now() - 86400000).toDateString() === d.toDateString();
  return ontem ? `ontem ${hhmm}` : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`;
}
