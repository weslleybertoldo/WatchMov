// WatchMov — tv-pair: login na TV pelo celular (W2 do app do Fire TV). Tabela public.wm_tv_pair.
// A TV não tem como entrar com o Google (Fire TV não tem navegador), então quem entra é o celular:
//   create  (sem login)          → { code, secret, expires_at }: a TV mostra o código/QR e guarda o segredo
//   approve (JWT do celular)     → gera um link mágico da conta de quem aprovou e guarda o token
//   poll    (código + segredo)   → { status: 'pending' } ou { status: 'approved', token_hash } (1× só)
//   register (JWT da TV)         → a TV logada se anota em wm_tv_devices (chave = sessão dela)
//   devices  (JWT do celular)    → TVs conectadas da conta (só as com sessão viva)
// A TV entra com supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }).
// Deploy com verify_jwt=false (create/poll são sem login; o approve confere o JWT aqui dentro).
// Secrets: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (injetados pela plataforma).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const TTL_MS = 5 * 60 * 1000;
// 32 símbolos sem O/0/I/1 (confundem lidos da TV); 256 % 32 == 0 → sorteio uniforme por byte.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODIGO_OK = /^[A-HJ-NP-Z2-9]{6}$/;

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
function novoCodigo(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALFABETO[b % ALFABETO.length]).join('');
}
async function sha256(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
// Aceita "abc-def", "ABC DEF"… (o celular digita); devolve null se não for um código possível.
function normalizar(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  const s = c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODIGO_OK.test(s) ? s : null;
}

async function criar(): Promise<Response> {
  // Pedidos vencidos há mais de 1 dia saem daqui: a tabela não cresce.
  await admin.from('wm_tv_pair').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString());
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  const secret_hash = await sha256(secret);
  const expires_at = new Date(Date.now() + TTL_MS).toISOString();
  for (let i = 0; i < 5; i++) {
    const code = novoCodigo();
    const { error } = await admin.from('wm_tv_pair').insert({ code, secret_hash, expires_at });
    if (!error) return json(200, { code, secret, expires_at });
    if (error.code !== '23505') throw error;   // 23505 = código já existe → sorteia outro
  }
  return erro(503, 'no_code', 'Tente de novo');
}

function jwtDe(req: Request): string {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
}
// Claim session_id do JWT (já validado pelo getUser antes de chamar isto).
function sessaoDoJwt(jwt: string): string | null {
  try {
    const b = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}
function texto(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

async function registrar(req: Request, body: Record<string, unknown>): Promise<Response> {
  const jwt = jwtDe(req);
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  const session_id = sessaoDoJwt(jwt);
  if (ue || !u?.user || !session_id) return erro(401, 'unauthorized', 'Sem login');
  const { error } = await admin.from('wm_tv_devices').upsert({
    session_id, user_id: u.user.id,
    name: texto(body.name, 40) ?? 'TV', model: texto(body.model, 60),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'session_id' });
  if (error) throw error;
  return json(200, { ok: true });
}

async function listar(req: Request): Promise<Response> {
  const { data: u, error: ue } = await admin.auth.getUser(jwtDe(req));
  if (ue || !u?.user) return erro(401, 'unauthorized', 'Entre no app do celular primeiro');
  const { data, error } = await admin.rpc('wm_tv_devices_live', { uid: u.user.id });
  if (error) throw error;
  return json(200, { devices: data ?? [] });
}

async function aprovar(req: Request, body: Record<string, unknown>): Promise<Response> {
  const jwt = jwtDe(req);
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  const email = u?.user?.email;
  if (ue || !u?.user || !email) return erro(401, 'unauthorized', 'Entre no app do celular primeiro');
  const code = normalizar(body.code);
  if (!code) return erro(400, 'bad_code', 'Código inválido');
  const { data: row, error: re } = await admin.from('wm_tv_pair')
    .select('expires_at, approved_at').eq('code', code).maybeSingle();
  if (re) throw re;
  if (!row) return erro(404, 'not_found', 'Código não encontrado');
  if (row.approved_at) return erro(409, 'already_approved', 'Esse código já foi usado');
  if (Date.parse(row.expires_at) < Date.now()) return erro(410, 'expired', 'Código vencido: a TV mostra outro');
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const token_hash = link?.properties?.hashed_token;
  if (le || !token_hash) throw le ?? new Error('generateLink sem hashed_token');
  // .is(approved_at, null): dois celulares aprovando o mesmo código ao mesmo tempo → só o 1º vale.
  const { data: upd, error: ue2 } = await admin.from('wm_tv_pair')
    .update({ user_id: u.user.id, token_hash, approved_at: new Date().toISOString() })
    .eq('code', code).is('approved_at', null).select('code');
  if (ue2) throw ue2;
  if (!upd?.length) return erro(409, 'already_approved', 'Esse código já foi usado');
  return json(200, { ok: true, email });
}

async function consultar(body: Record<string, unknown>): Promise<Response> {
  const code = normalizar(body.code);
  const secret = typeof body.secret === 'string' ? body.secret : '';
  if (!code || !secret) return erro(400, 'bad_request', 'Faltou código ou segredo');
  const { data: row, error: re } = await admin.from('wm_tv_pair')
    .select('secret_hash, expires_at, token_hash, approved_at, used_at').eq('code', code).maybeSingle();
  if (re) throw re;
  // Segredo errado responde igual a "não existe": quem só viu o código na TV não descobre nada.
  if (!row || row.secret_hash !== await sha256(secret)) return erro(404, 'not_found', 'Código não encontrado');
  if (row.used_at) return erro(410, 'used', 'Esse código já foi usado');
  if (!row.approved_at) {
    if (Date.parse(row.expires_at) < Date.now()) return erro(410, 'expired', 'Código vencido');
    return json(200, { status: 'pending' });
  }
  // Entrega o token UMA vez: marca usado e apaga o token no mesmo update.
  const { data: upd, error: ue } = await admin.from('wm_tv_pair')
    .update({ used_at: new Date().toISOString(), token_hash: null })
    .eq('code', code).is('used_at', null).select('code');
  if (ue) throw ue;
  if (!upd?.length) return erro(410, 'used', 'Esse código já foi usado');
  return json(200, { status: 'approved', token_hash: row.token_hash });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'method_not_allowed', 'Use POST');
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return erro(400, 'bad_json', 'Corpo inválido'); }
  const action = body?.action;
  try {
    if (action === 'create') return await criar();
    if (action === 'approve') return await aprovar(req, body);
    if (action === 'poll') return await consultar(body);
    if (action === 'register') return await registrar(req, body);
    if (action === 'devices') return await listar(req);
    return erro(400, 'bad_action', 'Ação desconhecida');
  } catch (e) {
    console.error(JSON.stringify({ fn: 'tv-pair', action, error: String((e as Error)?.message ?? e) }));
    return erro(500, 'internal', 'Erro interno');
  }
});
