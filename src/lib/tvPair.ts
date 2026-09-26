// Login na TV pelo celular (W2 do app do Fire TV) — cliente da edge function tv-pair.
// TV: createTvCode → mostra o código/QR → pollTvCode a cada 2 s → verifyOtp com o token.
// Celular (logado): approveTvCode(código) — pelo QR (link /tv?c=) ou digitando no Painel.

// O QR sempre aponta pro site de produção: no celular com o app, o link abre o app (App Link);
// sem o app, abre o site, que também aprova.
export const TV_LINK_BASE = 'https://watchmovbr.vercel.app/tv?c=';

const CODIGO_OK = /^[A-HJ-NP-Z2-9]{6}$/;   // mesmo alfabeto da edge (sem O/0/I/1)

export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODIGO_OK.test(s) ? s : null;
}

export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function tvLinkFor(code: string): string {
  return TV_LINK_BASE + code;
}

// "https://watchmovbr.vercel.app/tv?c=ABCDEF" (App Link no app, ou o endereço da página no site) → "ABCDEF".
export function codeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.pathname.replace(/\/+$/, '') !== '/tv') return null;
    return normalizeCode(u.searchParams.get('c'));
  } catch {
    return null;
  }
}

export interface TvCode { code: string; secret: string; expires_at: string; }
export type TvPoll =
  | { status: 'pending' }
  | { status: 'approved'; token_hash: string }
  | { status: 'expired' | 'used' | 'not_found' };
export type TvApprove = { ok: true; email: string } | { ok: false; message: string };

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tv-pair`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function call(body: Record<string, unknown>, token?: string): Promise<{ status: number; data: Record<string, any> }> {
  const r = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token || ANON}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

export async function createTvCode(): Promise<TvCode> {
  const { status, data } = await call({ action: 'create' });
  if (status !== 200 || !data.code || !data.secret) throw new Error(data?.error?.message || `tv-pair create ${status}`);
  return { code: data.code, secret: data.secret, expires_at: data.expires_at };
}

export async function pollTvCode(code: string, secret: string): Promise<TvPoll> {
  const { status, data } = await call({ action: 'poll', code, secret });
  if (status === 200) {
    return data.status === 'approved' && data.token_hash
      ? { status: 'approved', token_hash: data.token_hash }
      : { status: 'pending' };
  }
  if (status === 410) return { status: data?.error?.code === 'used' ? 'used' : 'expired' };
  if (status === 404) return { status: 'not_found' };
  throw new Error(`tv-pair poll ${status}`);
}

export async function approveTvCode(code: string, accessToken: string): Promise<TvApprove> {
  const { status, data } = await call({ action: 'approve', code }, accessToken);
  if (status === 200 && data.ok) return { ok: true, email: data.email };
  return { ok: false, message: data?.error?.message || 'Não deu pra entrar na TV. Tente de novo.' };
}

export interface TvDevice { session_id: string; name: string; model: string | null; created_at: string; last_seen_at: string; }

// A TV logada se anota (abrir o app de novo só atualiza "usada por último").
export async function registerTvDevice(accessToken: string, info: { name: string; model: string }): Promise<void> {
  const { status, data } = await call({ action: 'register', ...info }, accessToken);
  if (status !== 200) throw new Error(data?.error?.message || `tv-pair register ${status}`);
}

// Celular: TVs conectadas nesta conta (só as que ainda estão logadas).
export async function listTvDevices(accessToken: string): Promise<TvDevice[]> {
  const { status, data } = await call({ action: 'devices' }, accessToken);
  if (status !== 200) throw new Error(data?.error?.message || `tv-pair devices ${status}`);
  return Array.isArray(data.devices) ? data.devices : [];
}

// Aprovou no celular → a lista de TVs recarrega (a TV se anota uns segundos depois de entrar).
export const TV_APPROVED_EVENT = 'wm:tv-approved';

// Pedido de aprovação vindo de fora (QR aberto no site, App Link, botão do Painel). O diálogo do
// celular (TvApproveDialog) escuta; sem código = abre pra digitar.
export const TV_APPROVE_EVENT = 'wm:tv-approve';
const PENDING_KEY = 'wm_tv_code';

export function requestTvApprove(code?: string | null) {
  window.dispatchEvent(new CustomEvent(TV_APPROVE_EVENT, { detail: { code: code ?? null } }));
}

// Site aberto pelo QR (/tv?c=…): guarda o código antes do 1º render e limpa o endereço. Sobrevive
// ao login do Google (volta pra raiz na MESMA aba) e o diálogo abre depois de entrar.
export function capturePendingTvCode(loc: Location = window.location): void {
  const code = codeFromUrl(loc.href);
  if (!code) return;
  try { sessionStorage.setItem(PENDING_KEY, code); } catch { /* sem storage: segue sem */ }
  try { window.history.replaceState(null, '', '/'); } catch { /* ignore */ }
}

export function takePendingTvCode(): string | null {
  try {
    const c = sessionStorage.getItem(PENDING_KEY);
    if (c) sessionStorage.removeItem(PENDING_KEY);
    return normalizeCode(c);
  } catch {
    return null;
  }
}
