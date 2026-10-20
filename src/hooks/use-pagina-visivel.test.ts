import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaginaVisivel, paginaVisivel } from './use-pagina-visivel';

// O player nativo por cima deixa o WebView "hidden" (visibilitychange); ao fechar, volta "visible".
function mudar(estado: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('página na tela (item 7: a tela de trás para com o player aberto)', () => {
  afterEach(() => { mudar('visible'); });

  it('começa visível e acompanha o player abrindo e fechando', () => {
    mudar('visible');
    const { result } = renderHook(() => usePaginaVisivel());
    expect(result.current).toBe(true);
    act(() => mudar('hidden'));
    expect(result.current).toBe(false);
    expect(paginaVisivel()).toBe(false);
    act(() => mudar('visible'));
    expect(result.current).toBe(true);
  });

  it('nasce escondida se a página já estava escondida (app aberto por trás do player)', () => {
    mudar('hidden');
    const { result } = renderHook(() => usePaginaVisivel());
    expect(result.current).toBe(false);
  });
});
