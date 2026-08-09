import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { addNotice } from '@/lib/appNotices';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '@/lib/supabase';

// Notificações de lançamento (novo episódio / estreia de filme).
// O "sino" é uma linha em wm_notify_subs. REGRA (definida pelo Weslley):
//   entrar na Minha Lista -> liga (linha com enabled=true)
//   desmarcar o sino      -> enabled=false (segue desligado mesmo estando na lista)
//   sair da lista         -> a linha é APAGADA (re-adicionar volta a ligar)
//   clique manual         -> liga/desliga, dentro ou fora da lista

export interface NotifySub { tmdbId: number; type: 'movie' | 'tv'; enabled: boolean }

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());
let subs = new Map<number, NotifySub>();   // por tmdbId
let loaded = false;

const CACHE_KEY = 'watchmov_notify_subs';  // espelho local (UI responde offline)
function readCache(): NotifySub[] {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch { return []; }
}
function writeCache() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...subs.values()])); } catch { /* quota */ }
}

export async function loadSubs() {
  if (!loaded) { readCache().forEach(s => subs.set(s.tmdbId, s)); loaded = true; notify(); }
  const { data, error } = await supabase.from('wm_notify_subs').select('tmdb_id, type, enabled');
  if (error || !data) return;                       // offline: fica com o cache
  subs = new Map(data.map(r => [r.tmdb_id, { tmdbId: r.tmdb_id, type: r.type, enabled: r.enabled }]));
  writeCache(); notify();
}

export function isNotifyOn(tmdbId?: number): boolean {
  if (tmdbId == null) return false;
  return !!subs.get(tmdbId)?.enabled;
}

// Liga/desliga explicitamente (clique no sino ou ao favoritar).
export async function setNotify(o: { tmdbId: number; type: 'movie' | 'tv'; enabled: boolean; title?: string; posterUrl?: string }) {
  subs.set(o.tmdbId, { tmdbId: o.tmdbId, type: o.type, enabled: o.enabled });
  writeCache(); notify();
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return;
  await supabase.from('wm_notify_subs').upsert({
    user_id: u.user.id, tmdb_id: o.tmdbId, type: o.type, enabled: o.enabled,
    title: o.title, poster_url: o.posterUrl, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,tmdb_id,type' });
}

// Saiu da Minha Lista: APAGA a inscrição — assim, re-adicionar volta a ligar o sino
// (é o comportamento pedido: "só volta a ativar se remover e adicionar de novo").
export async function clearNotify(tmdbId: number, type: 'movie' | 'tv') {
  subs.delete(tmdbId);
  writeCache(); notify();
  await supabase.from('wm_notify_subs').delete().eq('tmdb_id', tmdbId).eq('type', type);
}

// ── Push (FCM) ──
// Registra o device e guarda o token. Sem permissão → não notifica (fail closed).
export async function initPush() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    // Canal próprio (Android 8+): o mesmo channel_id que a edge envia no payload.
    try {
      await PushNotifications.createChannel({
        id: 'watchmov_releases', name: 'Lançamentos',
        description: 'Novos episódios e estreias dos títulos que você acompanha',
        importance: 4, visibility: 1,
      });
    } catch { /* já existe */ }

    PushNotifications.addListener('registration', async (t) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u?.user) return;
      await supabase.from('wm_push_tokens').upsert({
        user_id: u.user.id, token: t.value, platform: 'android',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'token' });
    });
    PushNotifications.addListener('registrationError', (e) => console.warn('[push] registro falhou', e));
    // Guarda o aviso de estreia/episódio novo na central (aba Lançamentos): a
    // notificação do sistema some, o registro fica.
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      addNotice({ kind: 'release', title: n.title || 'Novidade', body: n.body || undefined });
    });
    await PushNotifications.register();
  } catch (e) {
    console.warn('[push] init falhou', e);
  }
}

// Abre o título ao tocar na notificação (data: {tmdbId, type}).
export function onPushOpen(cb: (d: { tmdbId: number; type: 'movie' | 'tv' }) => void) {
  if (!Capacitor.isNativePlatform()) return;
  PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const d = a.notification?.data || {};
    const tmdbId = Number(d.tmdbId);
    if (tmdbId) cb({ tmdbId, type: d.type === 'movie' ? 'movie' : 'tv' });
  });
}

// Hook reativo pro estado do sino de um título.
export function useNotify(tmdbId?: number): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    listeners.add(fn);
    if (!loaded) loadSubs();
    return () => { listeners.delete(fn); };
  }, []);
  return isNotifyOn(tmdbId);
}
