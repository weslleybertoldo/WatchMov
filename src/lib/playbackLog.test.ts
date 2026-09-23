import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const getSession = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ insert }), auth: { getSession: () => getSession() } },
}));
const pendingAppExits = vi.fn();
const ackAppExits = vi.fn();
vi.mock('@/lib/nativePlayer', () => ({
  onPlayerError: vi.fn(),
  pendingAppExits: () => pendingAppExits(),
  ackAppExits: (ts: number) => ackAppExits(ts),
}));

import { logAppExits } from './playbackLog';

// ts reais do celular dele (23/09/2026): o crash das 13:53 e o kill das 14:23.
const CRASH = 1790182393277;
const KILL = 1790184217155;
const exit = (ts: number, reason = 4) => ({ ts, reason, cause: '23/09 13:53:13 · erro no app · na tela' });

describe('logAppExits — a aba Bugs grava por que o app fechou', () => {
  beforeEach(() => {
    insert.mockReset().mockResolvedValue({ error: null });
    getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    pendingAppExits.mockReset();
    ackAppExits.mockReset();
  });

  it('cada fechamento vira APP_FECHOU na hora real e confirma o último', async () => {
    pendingAppExits.mockResolvedValue([exit(CRASH), exit(KILL, 2)]);
    expect(await logAppExits()).toBe(2);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toMatchObject({
      title: 'App fechou', error_name: 'APP_FECHOU', error_code: 4,
      created_at: new Date(CRASH).toISOString(), app_version: null,
    });
    expect(insert.mock.calls[1][0]).toMatchObject({ error_code: 2, created_at: new Date(KILL).toISOString() });
    expect(ackAppExits).toHaveBeenCalledTimes(1);
    expect(ackAppExits).toHaveBeenCalledWith(KILL);
  });

  it('erro no meio: confirma só até o que gravou — o resto vai no próximo boot', async () => {
    pendingAppExits.mockResolvedValue([exit(1), exit(2), exit(3)]);
    insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'sem rede' } });
    expect(await logAppExits()).toBe(1);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(ackAppExits).toHaveBeenCalledWith(1);
  });

  it('primeiro já falha: não confirma nada', async () => {
    pendingAppExits.mockResolvedValue([exit(1)]);
    insert.mockResolvedValueOnce({ error: { message: 'RLS' } });
    expect(await logAppExits()).toBe(0);
    expect(ackAppExits).not.toHaveBeenCalled();
  });

  it('sem sessão não grava nem confirma (a RLS exige usuário)', async () => {
    pendingAppExits.mockResolvedValue([exit(1)]);
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await logAppExits()).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(ackAppExits).not.toHaveBeenCalled();
  });

  it('nada pendente: nem consulta a sessão', async () => {
    pendingAppExits.mockResolvedValue([]);
    expect(await logAppExits()).toBe(0);
    expect(getSession).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
