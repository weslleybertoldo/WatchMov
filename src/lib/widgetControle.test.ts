import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Widget do controle na tela inicial (pedido dele 07/11/2026): o app entrega ao nativo o token próprio do widget,
// a TV escolhida e a lista de TVs; Sair esquece tudo.
const m = vi.hoisted(() => ({
  nativo: true,
  plataforma: 'android',
  tv: false,
  estado: vi.fn(),
  salvar: vi.fn(),
  limpar: vi.fn(),
  fixar: vi.fn(),
  listar: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => m.nativo, getPlatform: () => m.plataforma },
  registerPlugin: () => ({ estado: m.estado, salvar: m.salvar, limpar: m.limpar, fixar: m.fixar }),
}));
vi.mock('@/lib/device', () => ({ isTv: () => m.tv }));
vi.mock('@/lib/tvPair', () => ({ listTvDevices: m.listar }));

import { esquecerWidget, fixarWidget, guardarTvNoWidget, prepararWidget, sincronizarWidget, temWidget } from './widgetControle';

const sala = { session_id: 'tv-sala', name: 'TV da sala', model: 'Fire TV', created_at: '', last_seen_at: '' };
const proj = { ...sala, session_id: 'tv-proj', name: 'Projetor' };
const estado = (o: Partial<{ temToken: boolean; tv: { session_id: string; name: string } | null; widgets: number; suportaFixar: boolean }> = {}) =>
  ({ temToken: false, tv: null, widgets: 0, suportaFixar: true, ...o });
const fetchMock = vi.fn();
const salvos = () => m.salvar.mock.calls.map(c => c[0]);
const corpo = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

beforeEach(() => {
  m.nativo = true; m.plataforma = 'android'; m.tv = false;
  for (const f of [m.estado, m.salvar, m.limpar, m.fixar, m.listar, fetchMock]) f.mockReset();
  m.salvar.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('widgetControle', () => {
  it('só existe no celular Android com o app (nem na TV, nem no navegador)', () => {
    expect(temWidget()).toBe(true);
    m.tv = true; expect(temWidget()).toBe(false);
    m.tv = false; m.nativo = false; expect(temWidget()).toBe(false);
  });

  it('lista carregada no Controle remoto: guarda a lista e cria o token do widget com o login do app', async () => {
    m.estado.mockResolvedValue(estado());
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ token: 'a'.repeat(64) }) });
    await prepararWidget('jwt-do-app', [sala, proj]);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/functions\/v1\/tv-remote$/);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-do-app');
    expect(corpo().action).toBe('token');
    expect(salvos()[0]).toEqual({ tvs: [{ session_id: 'tv-sala', name: 'TV da sala' }, { session_id: 'tv-proj', name: 'Projetor' }] });
    expect(salvos()[1]).toMatchObject({ token: 'a'.repeat(64) });
    expect(typeof salvos()[1].url).toBe('string');
    expect(typeof salvos()[1].anon).toBe('string');
  });

  it('aparelho que já tem token não cria outro (só regrava endereço e chave)', async () => {
    m.estado.mockResolvedValue(estado({ temToken: true }));
    await prepararWidget('jwt', [sala]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(salvos()[1]).not.toHaveProperty('token');
  });

  it('servidor recusou o token: não grava nada de token', async () => {
    m.estado.mockResolvedValue(estado());
    fetchMock.mockResolvedValue({ status: 401, json: async () => ({ error: { code: 'unauthorized' } }) });
    await prepararWidget('jwt', [sala]);
    expect(salvos().some(s => 'token' in s)).toBe(false);
  });

  it('TV escolhida no app vira a TV do widget', async () => {
    await guardarTvNoWidget(sala);
    expect(salvos()).toEqual([{ tv: { session_id: 'tv-sala', name: 'TV da sala' } }]);
  });

  it('APK antigo sem o plugin: nada quebra', async () => {
    m.estado.mockRejectedValue(new Error('not implemented'));
    m.salvar.mockRejectedValue(new Error('not implemented'));
    await expect(prepararWidget('jwt', [sala])).resolves.toBeUndefined();
    await expect(guardarTvNoWidget(sala)).resolves.toBeUndefined();
    await expect(sincronizarWidget('jwt')).resolves.toBeUndefined();
  });

  it('abrir o app sem widget na tela: não faz nada', async () => {
    m.estado.mockResolvedValue(estado({ widgets: 0 }));
    await sincronizarWidget('jwt');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.listar).not.toHaveBeenCalled();
  });

  it('abrir o app com o widget na tela e uma TV só na conta: ela vira a TV do widget', async () => {
    m.estado.mockResolvedValue(estado({ widgets: 1, temToken: true }));
    m.listar.mockResolvedValue([sala]);
    await sincronizarWidget('jwt');
    expect(salvos()).toContainEqual({ tvs: [{ session_id: 'tv-sala', name: 'TV da sala' }] });
    expect(salvos()).toContainEqual({ tv: { session_id: 'tv-sala', name: 'TV da sala' } });
  });

  it('com duas TVs e nenhuma escolhida, o widget espera a escolha (não chuta)', async () => {
    m.estado.mockResolvedValue(estado({ widgets: 1, temToken: true }));
    m.listar.mockResolvedValue([sala, proj]);
    await sincronizarWidget('jwt');
    expect(salvos().some(s => 'tv' in s)).toBe(false);
  });

  it('Sair: limpa o nativo e apaga o token no servidor', async () => {
    m.limpar.mockResolvedValue({ token: 'b'.repeat(64) });
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ ok: true }) });
    await esquecerWidget();
    expect(m.limpar).toHaveBeenCalled();
    expect(corpo()).toEqual({ action: 'forget', token: 'b'.repeat(64) });
  });

  it('Sair sem rede ou sem token: não trava o Sair', async () => {
    m.limpar.mockResolvedValue({ token: null });
    await esquecerWidget();
    expect(fetchMock).not.toHaveBeenCalled();
    m.limpar.mockResolvedValue({ token: 'c'.repeat(64) });
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(esquecerWidget()).resolves.toBeUndefined();
  });

  it('Adicionar à tela inicial: devolve o que o Android respondeu', async () => {
    m.fixar.mockResolvedValue({ ok: true });
    expect(await fixarWidget()).toBe(true);
    m.fixar.mockRejectedValue(new Error('x'));
    expect(await fixarWidget()).toBe(false);
  });
});
