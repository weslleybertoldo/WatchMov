// Widget do controle remoto na tela inicial do celular (pedido dele 07/11/2026: "os botões no próprio widget, sem abrir
// o app" + "Trocar TV" abrindo uma janelinha com as TVs). Quem desenha e manda as teclas é o nativo (ControleWidget.java);
// daqui o app só entrega o que o widget precisa, pelo plugin WidgetControle:
//   - o token PRÓPRIO do widget (edge tv-remote, action 'token'): o widget não usa a sessão do app, que gira o refresh
//     token a cada uso e derrubaria o login;
//   - a TV escolhida no Controle remoto e a lista de TVs da conta (a janelinha "Trocar TV").
// O mesmo APK roda na TV, mas TV não tem widget: lá nada disso roda. APK antigo (sem o plugin) = tudo vira nada.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isTv } from '@/lib/device';
import { listTvDevices, type TvDevice } from '@/lib/tvPair';

export interface TvDoWidget { session_id: string; name: string }
export interface EstadoDoWidget { temToken: boolean; tv: TvDoWidget | null; widgets: number; suportaFixar: boolean }

interface WidgetControlePlugin {
  estado(): Promise<EstadoDoWidget>;
  salvar(o: { url?: string; anon?: string; token?: string; tv?: TvDoWidget | null; tvs?: TvDoWidget[] }): Promise<{ ok: boolean }>;
  limpar(): Promise<{ token?: string | null }>;
  fixar(): Promise<{ ok: boolean }>;
}
const Widget = registerPlugin<WidgetControlePlugin>('WidgetControle');

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const FN_URL = `${SB_URL}/functions/v1/tv-remote`;

export function temWidget(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && !isTv();
}

const soTv = (t: TvDevice | TvDoWidget): TvDoWidget => ({ session_id: t.session_id, name: t.name });

// Modelo do celular pro registro do token (só pra saber de onde é), tirado do user agent do WebView.
function modeloDoCelular(): string | undefined {
  const m = /;\s*([^;)]+?)\s+Build\//.exec(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return m?.[1]?.slice(0, 60);
}

export async function estadoDoWidget(): Promise<EstadoDoWidget | null> {
  if (!temWidget()) return null;
  try { return await Widget.estado(); } catch { return null; }
}

// Cria o token do widget quando o aparelho ainda não tem (uma vez por aparelho; o 401 do widget apaga e o app cria outro).
// Sempre regrava o endereço e a chave pública (o widget não lê o .env do app).
async function garantirToken(estado: EstadoDoWidget, accessToken: string): Promise<boolean> {
  if (estado.temToken) {
    await Widget.salvar({ url: SB_URL, anon: ANON });
    return true;
  }
  const r = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'token', device: modeloDoCelular() }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status !== 200 || typeof data?.token !== 'string') return false;
  await Widget.salvar({ url: SB_URL, anon: ANON, token: data.token });
  return true;
}

// Controle remoto do app: a lista carregou → o widget fica com o token e com a lista nova (a TV que saiu da conta sai do
// widget também).
export async function prepararWidget(accessToken: string, tvs: TvDevice[]): Promise<void> {
  const estado = await estadoDoWidget();
  if (!estado) return;
  try {
    await Widget.salvar({ tvs: tvs.map(soTv) });
    await garantirToken(estado, accessToken);
  } catch { /* o controle do app segue igual */ }
}

// Controle remoto do app: a TV escolhida vira a do widget.
export async function guardarTvNoWidget(tv: TvDevice | TvDoWidget): Promise<void> {
  if (!temWidget()) return;
  try { await Widget.salvar({ tv: soTv(tv) }); } catch { /* APK antigo */ }
}

// Abrir o app com o widget na tela: deixa ele pronto sem precisar passar pelo Controle remoto (token, lista e, se a
// conta tem uma TV só, ela mesma).
export async function sincronizarWidget(accessToken: string): Promise<void> {
  const estado = await estadoDoWidget();
  if (!estado || estado.widgets === 0) return;
  try {
    if (!(await garantirToken(estado, accessToken))) return;
    const tvs = await listTvDevices(accessToken);
    await Widget.salvar({ tvs: tvs.map(soTv) });
    if (!estado.tv && tvs.length === 1) await Widget.salvar({ tv: soTv(tvs[0]) });
  } catch { /* sem rede: tenta de novo na próxima abertura */ }
}

// Sair: o widget esquece a conta (e o token morre no servidor, sem esperar mais que 3 s).
export async function esquecerWidget(): Promise<void> {
  if (!temWidget()) return;
  let token: string | null | undefined;
  try { token = (await Widget.limpar()).token; } catch { return; }
  if (!token) return;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 3000);
  try {
    await fetch(FN_URL, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ action: 'forget', token }),
    });
  } catch { /* sem rede: o token fica sem uso no servidor */ } finally { clearTimeout(t); }
}

// Botão "Pôr na tela inicial": o Android pergunta e põe o widget (launcher que não suporta → false).
export async function fixarWidget(): Promise<boolean> {
  if (!temWidget()) return false;
  try { return (await Widget.fixar()).ok === true; } catch { return false; }
}
