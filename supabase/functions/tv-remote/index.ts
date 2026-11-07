// WatchMov — tv-remote: o WIDGET do controle remoto na tela inicial do celular (pedido dele 07/11/2026: "os botões no
// próprio widget, sem abrir o app"). Tabela public.wm_widget_tokens.
// O widget não tem o login do app (o refresh token gira a cada uso e derrubaria o login do app), então usa um token
// PRÓPRIO, criado pelo app logado; aqui fica só o sha256 dele.
//   token  (JWT do celular)  → { token }: cria o token do widget deste aparelho; `old` = o token anterior dele, que sai
//   key    (token do widget) → manda a tecla pra TV `to` no canal privado wm-tv:<user_id>, evento 'ctl' (o MESMO do
//                              controle do app: a TV com o WatchMov aberto executa). Não espera a TV responder.
//   tvs    (token do widget) → TVs conectadas da conta (a janelinha "Trocar TV" do widget)
//   forget (token do widget) → apaga o token (Sair no app)
// Deploy com verify_jwt=false (o widget chama só com a chave anon; quem decide é o token, aqui dentro).
// Secrets: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SB_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// As teclas do controle do app (TeclaControle em src/lib/tvRemote.ts), menos o 'ok-hold': no widget não existe segurar.
const TECLAS = new Set(['up', 'down', 'left', 'right', 'ok', 'back', 'home', 'rew', 'ff', 'playpause', 'prev-ep', 'next-ep', 'watched']);
const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_OK = /^[0-9a-f]{64}$/;
const MAX_APARELHOS = 10;        // tokens por conta: o mais antigo sai (reinstalou o app, trocou de celular…)
const USO_MS = 3_600_000;        // last_used_at regravado no máximo 1×/h
// Teclas seguidas (↓ ↓ ↓ OK) não consultam o banco a cada toque: o dono do token fica 60 s na memória da função.
// Token apagado (Sair no app) em outra instância da função ainda vale no máximo esses 60 s.
const CACHE_MS = 60_000;
const cache = new Map<string, { uid: string; ate: number }>();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-schema',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
function erro(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
function texto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}
function jwtDe(req: Request): string {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
}

async function criarToken(req: Request, body: Record<string, unknown>): Promise<Response> {
  const { data: u, error: ue } = await admin.auth.getUser(jwtDe(req));
  if (ue || !u?.user) return erro(401, 'unauthorized', 'Entre no app primeiro');
  const uid = u.user.id;
  // O token anterior deste aparelho sai (só se for desta conta).
  if (typeof body.old === 'string' && TOKEN_OK.test(body.old)) {
    const velho = await sha256(body.old);
    cache.delete(velho);
    const { error } = await admin.from('wm_widget_tokens').delete().eq('token_hash', velho).eq('user_id', uid);
    if (error) throw error;
  }
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await admin.from('wm_widget_tokens')
    .insert({ token_hash: await sha256(token), user_id: uid, device: texto(body.device, 60) });
  if (error) throw error;
  // A tabela não cresce: fica só o token dos MAX_APARELHOS aparelhos mais novos da conta.
  const { data: todos, error: le } = await admin.from('wm_widget_tokens')
    .select('token_hash').eq('user_id', uid).order('created_at', { ascending: false });
  if (le) throw le;
  const sobra = (todos ?? []).slice(MAX_APARELHOS).map(t => t.token_hash);
  if (sobra.length) {
    const { error: de } = await admin.from('wm_widget_tokens').delete().in('token_hash', sobra);
    if (de) throw de;
  }
  return json(200, { token });
}

// Dono do token do widget, ou null (token apagado/inventado).
async function donoDoToken(token: unknown): Promise<string | null> {
  if (typeof token !== 'string' || !TOKEN_OK.test(token)) return null;
  const hash = await sha256(token);
  const guardado = cache.get(hash);
  if (guardado && guardado.ate > Date.now()) return guardado.uid;
  const { data, error } = await admin.from('wm_widget_tokens').select('user_id, last_used_at').eq('token_hash', hash).maybeSingle();
  if (error) throw error;
  if (!data) { cache.delete(hash); return null; }
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > USO_MS) {
    const { error: ue } = await admin.from('wm_widget_tokens').update({ last_used_at: new Date().toISOString() }).eq('token_hash', hash);
    if (ue) console.error(JSON.stringify({ fn: 'tv-remote', etapa: 'last_used_at', error: ue.message }));
  }
  if (cache.size > 500) cache.clear();
  cache.set(hash, { uid: data.user_id, ate: Date.now() + CACHE_MS });
  return data.user_id;
}

async function tecla(body: Record<string, unknown>): Promise<Response> {
  const uid = await donoDoToken(body.token);
  if (!uid) return erro(401, 'bad_token', 'Abra o WatchMov e escolha a TV no Controle remoto');
  const to = typeof body.to === 'string' && UUID_OK.test(body.to) ? body.to : null;
  const key = typeof body.key === 'string' && TECLAS.has(body.key) ? body.key : null;
  if (!to || !key) return erro(400, 'bad_request', 'Faltou a TV ou a tecla');
  // Broadcast pelo REST do Realtime com a service role (passa pela policy do canal privado). A TV filtra pelo `to`
  // (a sessão dela) e ignora id repetido.
  const r = await fetch(`${SB_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{
      topic: `wm-tv:${uid}`, event: 'ctl', private: true,
      payload: { id: crypto.randomUUID(), to, action: 'key', key },
    }] }),
  });
  if (!r.ok) {
    console.error(JSON.stringify({ fn: 'tv-remote', etapa: 'broadcast', status: r.status, body: (await r.text()).slice(0, 200) }));
    return erro(502, 'broadcast_failed', 'Não deu pra falar com a TV agora');
  }
  return json(200, { ok: true });
}

async function tvs(body: Record<string, unknown>): Promise<Response> {
  const uid = await donoDoToken(body.token);
  if (!uid) return erro(401, 'bad_token', 'Abra o WatchMov e escolha a TV no Controle remoto');
  const { data, error } = await admin.rpc('wm_tv_devices_live', { uid });
  if (error) throw error;
  return json(200, { devices: data ?? [] });
}

async function esquecer(body: Record<string, unknown>): Promise<Response> {
  if (typeof body.token === 'string' && TOKEN_OK.test(body.token)) {
    const hash = await sha256(body.token);
    cache.delete(hash);
    const { error } = await admin.from('wm_widget_tokens').delete().eq('token_hash', hash);
    if (error) throw error;
  }
  return json(200, { ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'method_not_allowed', 'Use POST');
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return erro(400, 'bad_json', 'Corpo inválido'); }
  const action = body?.action;
  try {
    if (action === 'key') return await tecla(body);
    if (action === 'tvs') return await tvs(body);
    if (action === 'token') return await criarToken(req, body);
    if (action === 'forget') return await esquecer(body);
    return erro(400, 'bad_action', 'Ação desconhecida');
  } catch (e) {
    console.error(JSON.stringify({ fn: 'tv-remote', action, error: String((e as Error)?.message ?? e) }));
    return erro(500, 'internal', 'Erro interno');
  }
});
