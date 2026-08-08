// WatchMov — notify-releases
// Roda 1x/dia (cron). Varre as inscrições ligadas (wm_notify_subs.enabled), consulta
// a TMDB e envia push FCM quando:
//   série -> existe episódio com air_date == hoje (fuso America/Sao_Paulo)
//   filme -> release_date == hoje
// Dedup por last_notified_key ('s2e3' / 'released') pra não repetir o mesmo aviso.
//
// Secrets necessários: TMDB_API_KEY, FIREBASE_SERVICE_ACCOUNT (JSON da service
// account), SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TMDB = 'https://api.themoviedb.org/3';
const TMDB_KEY = Deno.env.get('TMDB_API_KEY')!;
const SA = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Data de hoje no fuso de SP (a TMDB usa datas locais de exibição).
function todaySP(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

async function tmdb<T>(path: string): Promise<T | null> {
  const r = await fetch(`${TMDB}${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB_KEY}&language=pt-BR`);
  return r.ok ? await r.json() as T : null;
}

// ── FCM HTTP v1: access token via JWT assinado com a service account ──
function b64url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(new TextEncoder().encode(JSON.stringify({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })));
  const pem = SA.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64url(sig)}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('FCM auth falhou: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

async function sendPush(token: string, title: string, body: string, data: Record<string, string>, at: string) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data,
        android: { priority: 'HIGH', notification: { channel_id: 'watchmov_releases' } },
      },
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    // Token morto (app desinstalado): limpa pra não tentar de novo.
    if (r.status === 404 || txt.includes('UNREGISTERED') || txt.includes('INVALID_ARGUMENT')) {
      await admin.from('wm_push_tokens').delete().eq('token', token);
    }
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  const today = todaySP();
  const url = new URL(req.url);
  const force = url.searchParams.get('force');   // teste manual: ?force=s1e1 ou ?force=released
  const dry = url.searchParams.get('dry') === '1';

  const { data: subs, error } = await admin
    .from('wm_notify_subs').select('*').eq('enabled', true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const report: unknown[] = [];
  let at = '';
  try { at = await accessToken(); } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  for (const s of subs ?? []) {
    let hit: { key: string; title: string; body: string } | null = null;

    if (s.type === 'tv') {
      const d = await tmdb<{ name?: string; last_episode_to_air?: { air_date: string; season_number: number; episode_number: number; name?: string }; next_episode_to_air?: { air_date: string; season_number: number; episode_number: number; name?: string } }>(`/tv/${s.tmdb_id}`);
      const cand = [d?.last_episode_to_air, d?.next_episode_to_air].filter(Boolean) as NonNullable<typeof d>['last_episode_to_air'][];
      const ep = cand.find(e => e!.air_date === today);
      if (ep) {
        const key = `s${ep!.season_number}e${ep!.episode_number}`;
        hit = {
          key,
          title: s.title || d?.name || 'Novo episódio',
          body: `Episódio novo disponível: T${ep!.season_number} E${ep!.episode_number}${ep!.name ? ` — ${ep!.name}` : ''}`,
        };
      }
    } else {
      const d = await tmdb<{ title?: string; release_date?: string }>(`/movie/${s.tmdb_id}`);
      if (d?.release_date === today) {
        hit = { key: 'released', title: s.title || d?.title || 'Estreia hoje', body: 'Estreia hoje — já pode assistir.' };
      }
    }

    if (force && !hit) {
      hit = { key: `force-${force}`, title: s.title || 'WatchMov', body: 'Teste de notificação — está funcionando.' };
    }
    if (!hit || hit.key === s.last_notified_key) continue;

    const { data: tokens } = await admin.from('wm_push_tokens').select('token').eq('user_id', s.user_id);
    let sent = 0;
    if (!dry) {
      for (const t of tokens ?? []) {
        if (await sendPush(t.token, hit.title, hit.body, { tmdbId: String(s.tmdb_id), type: s.type }, at)) sent++;
      }
      if (sent > 0) {
        await admin.from('wm_notify_subs')
          .update({ last_notified_key: hit.key, updated_at: new Date().toISOString() })
          .eq('id', s.id);
      }
    }
    report.push({ tmdb_id: s.tmdb_id, type: s.type, key: hit.key, tokens: tokens?.length ?? 0, sent });
  }

  return new Response(JSON.stringify({ today, subs: subs?.length ?? 0, notified: report }, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
