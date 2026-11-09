import { describe, it, expect, vi, beforeEach } from 'vitest';

const getLancamento = vi.fn();
vi.mock('@/lib/tmdb', () => ({ getLancamento: (...a: unknown[]) => getLancamento(...a) }));
const addNotice = vi.fn();
vi.mock('@/lib/appNotices', () => ({ addNotice: (...a: unknown[]) => addNotice(...a) }));
const focar = vi.fn(() => Promise.resolve(true));
vi.mock('@/lib/desktop', () => ({ desktop: { focar: () => focar() } }));

import { avisoDoTitulo, aoAbrirAvisoDesktop, conferirAvisos, diasAntes, hojeSP } from './avisoDesktop';

const ep = (air_date: string, season_number: number, episode_number: number, name?: string) => ({ air_date, season_number, episode_number, name });

describe('regra do sino (= edge notify-releases)', () => {
  it('janela de 2 dias e fuso de SP', () => {
    expect(diasAntes('2026-11-08', 2)).toBe('2026-11-06');
    expect(diasAntes('2026-03-01', 2)).toBe('2026-02-27');
    expect(hojeSP(new Date('2026-11-09T02:30:00Z'))).toBe('2026-11-08');   // 23h30 em SP ainda é dia 8
  });

  it('série: o episódio mais recente que já saiu dentro da janela', () => {
    const l = { titulo: 'Wandinha', episodios: [ep('2026-11-07', 2, 5, 'O baile'), ep('2026-11-14', 2, 6)] };
    expect(avisoDoTitulo('tv', l, '2026-11-08')).toEqual({ chave: 's2e5', titulo: 'Wandinha', corpo: 'Episódio novo disponível: T2 E5 — O baile' });
    expect(avisoDoTitulo('tv', l, '2026-11-10')).toBeNull();               // saiu há 3 dias: fora da janela
    expect(avisoDoTitulo('tv', l, '2026-11-14')?.chave).toBe('s2e6');      // o próximo chegou
    expect(avisoDoTitulo('tv', { titulo: 'X', episodios: [] }, '2026-11-08')).toBeNull();
  });

  it('filme: estreia na janela', () => {
    expect(avisoDoTitulo('movie', { titulo: 'A Odisseia', estreia: '2026-11-08' }, '2026-11-08')).toEqual({ chave: 'released', titulo: 'A Odisseia', corpo: 'Já disponível — pode assistir.' });
    expect(avisoDoTitulo('movie', { titulo: 'A Odisseia', estreia: '2026-11-09' }, '2026-11-08')).toBeNull();
    expect(avisoDoTitulo('movie', { titulo: 'A Odisseia' }, '2026-11-08')).toBeNull();
  });
});

describe('conferência no PC', () => {
  const avisos: { titulo: string; o: NotificationOptions; n: { onclick: (() => void) | null } }[] = [];
  beforeEach(() => {
    localStorage.clear();
    avisos.length = 0;
    getLancamento.mockReset(); addNotice.mockReset(); focar.mockClear();
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(titulo: string, o: NotificationOptions) { avisos.push({ titulo, o, n: this }); }
    }
    vi.stubGlobal('Notification', FakeNotification);
  });

  it('avisa o que é novo (Windows + central) e não repete na hora seguinte', async () => {
    getLancamento.mockImplementation((id: number) => Promise.resolve(id === 1
      ? { titulo: 'Wandinha', episodios: [ep('2026-11-07', 2, 5)] }
      : { titulo: 'Velho', episodios: [ep('2026-10-01', 1, 1)] }));
    const subs = [{ tmdbId: 1, type: 'tv' as const }, { tmdbId: 2, type: 'tv' as const }];
    expect(await conferirAvisos(subs, '2026-11-08')).toBe(1);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].titulo).toBe('Wandinha');
    expect(avisos[0].o.body).toBe('Episódio novo disponível: T2 E5');
    expect(addNotice).toHaveBeenCalledWith({ kind: 'release', title: 'Wandinha', body: 'Episódio novo disponível: T2 E5' });
    expect(await conferirAvisos(subs, '2026-11-08')).toBe(0);   // mesma chave: não repete
    expect(avisos).toHaveLength(1);
  });

  it('clicar no aviso traz a janela e abre o título', async () => {
    const abrir = vi.fn();
    aoAbrirAvisoDesktop(abrir);
    getLancamento.mockResolvedValue({ titulo: 'A Odisseia', estreia: '2026-11-08' });
    await conferirAvisos([{ tmdbId: 1368337, type: 'movie' }], '2026-11-08');
    avisos[0].n.onclick?.();
    expect(focar).toHaveBeenCalled();
    expect(abrir).toHaveBeenCalledWith({ tmdbId: 1368337, type: 'movie' });
  });

  it('TMDB fora do ar: pula o título e tenta na próxima', async () => {
    getLancamento.mockRejectedValue(new Error('TMDB 503'));
    expect(await conferirAvisos([{ tmdbId: 1, type: 'tv' }], '2026-11-08')).toBe(0);
    expect(avisos).toHaveLength(0);
  });
});
