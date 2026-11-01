import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchItem } from '@/types/watch';

vi.mock('@/lib/notifications', () => ({ setNotify: vi.fn(async () => {}), clearNotify: vi.fn(async () => {}) }));
import { setNotify, clearNotify } from '@/lib/notifications';
import { gravarFavorito } from './gravarFavorito';

const ficha = { id: 'f1', title: 'X', type: 'movie', createdAt: '2026-11-01' } as WatchItem;
const titulo = (type: 'movie' | 'tv', emBreve = false) => ({ tmdbId: 7, type, title: 'X', posterUrl: 'p.jpg', emBreve });

// Regra do sino (notifications.ts): entrar nos favoritos LIGA (série sempre; filme só antes da estreia), sair APAGA.
describe('gravarFavorito', () => {
  beforeEach(() => { vi.mocked(setNotify).mockClear(); vi.mocked(clearNotify).mockClear(); });

  it('grava o favorito na ficha', () => {
    const update = vi.fn();
    gravarFavorito(update, ficha, true, titulo('movie'));
    expect(update).toHaveBeenCalledWith('f1', { favorite: true });
  });

  it('série entrando liga o sino', () => {
    gravarFavorito(vi.fn(), ficha, true, titulo('tv'));
    expect(setNotify).toHaveBeenCalledWith({ tmdbId: 7, type: 'tv', enabled: true, title: 'X', posterUrl: 'p.jpg' });
  });

  it('filme já lançado entrando NÃO liga o sino; filme em breve liga', () => {
    gravarFavorito(vi.fn(), ficha, true, titulo('movie', false));
    expect(setNotify).not.toHaveBeenCalled();
    gravarFavorito(vi.fn(), ficha, true, titulo('movie', true));
    expect(setNotify).toHaveBeenCalledTimes(1);
  });

  it('saindo apaga a inscrição do sino', () => {
    const update = vi.fn();
    gravarFavorito(update, ficha, false, titulo('tv'));
    expect(update).toHaveBeenCalledWith('f1', { favorite: false });
    expect(clearNotify).toHaveBeenCalledWith(7, 'tv');
    expect(setNotify).not.toHaveBeenCalled();
  });
});
