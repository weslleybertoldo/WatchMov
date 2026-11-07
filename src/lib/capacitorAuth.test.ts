import { describe, it, expect, vi, beforeEach } from 'vitest';

// App do Windows (pedido dele 07/11/2026): o login do Google abre no navegador do PC e volta pro app pelo mesmo
// endereço do APK (com.weslley.watchmov://login-callback).
type Pc = { abrirFora: ReturnType<typeof vi.fn>; linkPendente: ReturnType<typeof vi.fn>; aoAbrirLink: ReturnType<typeof vi.fn> };
const m = vi.hoisted(() => ({
  nativo: false,
  desktop: undefined as Pc | undefined,
  oauth: vi.fn(),
  setSession: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.nativo } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn(), close: vi.fn() } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(() => ({ remove: vi.fn() })) } }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithOAuth: m.oauth, setSession: m.setSession } } }));
vi.mock('@/lib/desktop', () => ({ get desktop() { return m.desktop; } }));

import { concluirRetorno, setupDeepLinkListener, signInWithGoogle } from './capacitorAuth';

const RETORNO = 'com.weslley.watchmov://login-callback';
const GOOGLE = 'https://nnvwpgpvzysvyntdrtay.supabase.co/auth/v1/authorize?provider=google';

function pcFalso() {
  const ouvintes: ((u: string) => void)[] = [];
  const parar = vi.fn();
  const pc: Pc = {
    abrirFora: vi.fn().mockResolvedValue(true),
    linkPendente: vi.fn().mockResolvedValue(null),
    aoAbrirLink: vi.fn((cb: (u: string) => void) => { ouvintes.push(cb); return parar; }),
  };
  return { pc, parar, chegar: (u: string) => ouvintes.forEach((cb) => cb(u)) };
}

beforeEach(() => {
  m.nativo = false;
  m.desktop = undefined;
  m.oauth.mockReset().mockResolvedValue({ data: { url: GOOGLE }, error: null });
  m.setSession.mockReset().mockResolvedValue({ error: null });
});

describe('concluirRetorno', () => {
  it('tokens no # viram a sessão', async () => {
    expect(await concluirRetorno(`${RETORNO}#access_token=a&refresh_token=b&token_type=bearer`)).toEqual({});
    expect(m.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'b' });
  });

  it('Google recusou: devolve o motivo e não grava sessão', async () => {
    expect(await concluirRetorno(`${RETORNO}?error=access_denied&error_description=Cancelado`)).toEqual({ error: 'Cancelado' });
    expect(m.setSession).not.toHaveBeenCalled();
  });

  it('retorno sem nada: resposta inválida', async () => {
    expect(await concluirRetorno(RETORNO)).toEqual({ error: 'Resposta de login invalida' });
  });
});

describe('login no app do Windows', () => {
  it('abre o Google no navegador do PC e entra quando o link volta', async () => {
    const f = pcFalso();
    m.desktop = f.pc;
    const entrando = signInWithGoogle();
    await vi.waitFor(() => expect(f.pc.abrirFora).toHaveBeenCalledWith(GOOGLE));
    expect(m.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: RETORNO, skipBrowserRedirect: true } });
    f.chegar('https://outro.site/qualquer');          // link de outro esquema: ignora
    f.chegar(`${RETORNO}#access_token=a&refresh_token=b`);
    expect(await entrando).toEqual({});
    expect(m.setSession).toHaveBeenCalledTimes(1);
    expect(f.parar).toHaveBeenCalled();
  });

  it('navegador não abriu: avisa o erro e para de ouvir', async () => {
    const f = pcFalso();
    f.pc.abrirFora.mockResolvedValue(false);
    m.desktop = f.pc;
    expect(await signInWithGoogle()).toEqual({ error: 'Erro ao abrir o navegador' });
    expect(f.parar).toHaveBeenCalled();
  });

  it('cancelou no Google: o erro chega na tela de login', async () => {
    const f = pcFalso();
    m.desktop = f.pc;
    const entrando = signInWithGoogle();
    await vi.waitFor(() => expect(f.pc.abrirFora).toHaveBeenCalled());
    f.chegar(`${RETORNO}#error=access_denied&error_description=Cancelado`);
    expect(await entrando).toEqual({ error: 'Cancelado' });
  });

  it('app aberto PELO link (estava fechado): entra sozinho', async () => {
    const f = pcFalso();
    f.pc.linkPendente.mockResolvedValue(`${RETORNO}#access_token=x&refresh_token=y`);
    m.desktop = f.pc;
    setupDeepLinkListener();
    await vi.waitFor(() => expect(m.setSession).toHaveBeenCalledWith({ access_token: 'x', refresh_token: 'y' }));
  });

  it('site no navegador continua igual (volta pro próprio site)', async () => {
    await signInWithGoogle();
    expect(m.oauth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } });
  });
});
