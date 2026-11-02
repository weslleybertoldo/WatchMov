import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import MediaRow from './MediaRow';
import type { MediaSummary } from '@/lib/tmdb';
import { isTv } from '@/lib/device';

vi.mock('@/lib/device', () => ({ isTv: vi.fn(() => false) }));
// Fila do tempo ocioso de mentira: o teste diz quando o navegador ficou ocioso.
const { ocioso } = vi.hoisted(() => ({ ocioso: [] as Array<() => void> }));
vi.mock('@/lib/ocioso', () => ({
  naFilaDoOcioso: (t: () => void) => { ocioso.push(t); return () => { const i = ocioso.indexOf(t); if (i >= 0) ocioso.splice(i, 1); }; },
}));
const ficarOcioso = () => act(() => { ocioso.shift()!(); });

const itens = (n: number): MediaSummary[] => Array.from({ length: n }, (_, i) => ({
  type: 'movie', tmdbId: 9000 + i, title: `Filme ${i}`, posterUrl: `https://image.tmdb.org/t/p/w342/f${i}.jpg`,
}));

// IntersectionObserver de mentira: o teste diz quando a fileira chegou perto da tela.
let observadores: { cb: IntersectionObserverCallback; opts?: IntersectionObserverInit; alvos: Element[]; desligado: boolean }[] = [];
class FakeIO {
  private o: (typeof observadores)[number];
  constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
    this.o = { cb, opts, alvos: [], desligado: false };
    observadores.push(this.o);
  }
  observe(el: Element) { this.o.alvos.push(el); }
  unobserve() {}
  disconnect() { this.o.desligado = true; }
  takeRecords() { return []; }
}
const chegarPerto = () => act(() => {
  for (const o of observadores) {
    if (o.desligado) continue;
    o.cb(o.alvos.map(target => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry), {} as IntersectionObserver);
  }
});

// W4 das quedas na Fire TV (01/11/2026): na TV a fileira só monta os cartões quando chega perto da tela.
describe('MediaRow — fileiras só quando aparecem (TV)', () => {
  beforeEach(() => {
    observadores = [];
    ocioso.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeIO);
    vi.mocked(isTv).mockReturnValue(false);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('no celular monta os cartões na hora (como antes)', () => {
    const { container } = render(<MediaRow title="Ação" items={itens(4)} onOpen={() => {}} />);
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(4);
    expect(container.querySelector('[data-fileira-reservada]')).toBeNull();
    expect(observadores).toHaveLength(0);
  });

  it('na TV fica só o espaço reservado até a fileira chegar perto da tela; aí monta os cartões', () => {
    vi.mocked(isTv).mockReturnValue(true);
    const { container } = render(<MediaRow title="Comédia" cacheKey="w4-comedia" items={itens(5)} onOpen={() => {}} />);
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(0);
    expect(container.querySelector('[data-fileira-reservada]')).not.toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Comédia');   // o título da fileira já aparece
    expect(observadores[0].opts?.rootMargin).toBe('600px 0px');
    chegarPerto();
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(5);
    expect(container.querySelector('[data-fileira-reservada]')).toBeNull();
    expect(observadores[0].desligado).toBe(true);
  });

  it('na TV a fileira que já apareceu remonta JÁ com os cartões (voltar do detalhe não mexe na âncora)', () => {
    vi.mocked(isTv).mockReturnValue(true);
    const a = render(<MediaRow title="Drama" cacheKey="w4-drama" items={itens(3)} onOpen={() => {}} />);
    chegarPerto();
    a.unmount();
    observadores = [];
    const b = render(<MediaRow title="Drama" cacheKey="w4-drama" items={itens(3)} onOpen={() => {}} />);
    expect(b.container.querySelectorAll('[data-tv-card]')).toHaveLength(3);
    expect(observadores).toHaveLength(0);
  });

  it('na TV as fileiras longe da tela montam no tempo ocioso, 1,5 s depois, uma por vez e de cima pra baixo', () => {
    vi.mocked(isTv).mockReturnValue(true);
    vi.useFakeTimers();
    const { container } = render(<div>
      <MediaRow title="Guerra" cacheKey="w4-guerra" items={itens(3)} onOpen={() => {}} />
      <MediaRow title="Faroeste" cacheKey="w4-faroeste" items={itens(4)} onOpen={() => {}} />
    </div>);
    const cartoes = (k: string) => container.querySelectorAll(`[data-row-key="${k}"] [data-tv-card]`).length;
    expect([cartoes('w4-guerra'), cartoes('w4-faroeste')]).toEqual([0, 0]);
    act(() => { vi.advanceTimersByTime(1400); });
    expect(ocioso).toHaveLength(0);                       // a aba aparece primeiro: nada na fila ainda
    act(() => { vi.advanceTimersByTime(100); });
    expect(ocioso).toHaveLength(2);
    ficarOcioso();
    expect([cartoes('w4-guerra'), cartoes('w4-faroeste')]).toEqual([3, 0]);
    ficarOcioso();
    expect([cartoes('w4-guerra'), cartoes('w4-faroeste')]).toEqual([3, 4]);
    expect(observadores.filter(o => !o.desligado)).toHaveLength(2);   // seguem olhando: aparecer = virar "vista"
    vi.useRealTimers();
  });

  it('na TV a fileira montada só no ocioso NÃO conta como vista; a que aparece na tela, sim', () => {
    vi.mocked(isTv).mockReturnValue(true);
    vi.useFakeTimers();
    const so = render(<MediaRow title="Policial" cacheKey="w4-policial" items={itens(3)} onOpen={() => {}} />);
    act(() => { vi.advanceTimersByTime(1500); });
    ficarOcioso();
    expect(so.container.querySelectorAll('[data-tv-card]')).toHaveLength(3);
    so.unmount();
    // Início → aba Filmes: a fileira de gênero que o Início montou no ocioso chega na Filmes só com o espaço reservado
    const de_novo = render(<MediaRow title="Policial" cacheKey="w4-policial" items={itens(3)} onOpen={() => {}} />);
    expect(de_novo.container.querySelectorAll('[data-tv-card]')).toHaveLength(0);
    chegarPerto();
    expect(de_novo.container.querySelectorAll('[data-tv-card]')).toHaveLength(3);
    de_novo.unmount();
    observadores = [];
    const vista = render(<MediaRow title="Policial" cacheKey="w4-policial" items={itens(3)} onOpen={() => {}} />);
    expect(vista.container.querySelectorAll('[data-tv-card]')).toHaveLength(3);    // apareceu → remonta com os cartões
    expect(observadores).toHaveLength(0);
    vi.useRealTimers();
  });

  it('na TV a fileira que chega perto da tela antes da vez monta na hora e sai da fila do ocioso', () => {
    vi.mocked(isTv).mockReturnValue(true);
    vi.useFakeTimers();
    const { container } = render(<MediaRow title="Musical" cacheKey="w4-musical" items={itens(2)} onOpen={() => {}} />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(ocioso).toHaveLength(1);
    chegarPerto();
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(2);
    expect(ocioso).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(ocioso).toHaveLength(0);                       // não entra de novo na fila
    vi.useRealTimers();
  });

  // W2 do raio-x (02/11/2026): menos trabalho de uma vez na troca de aba.
  it('na TV a fileira entra com 8 cartazes; os de trás e o "Ver mais" entram no ocioso', () => {
    vi.mocked(isTv).mockReturnValue(true);
    const { container } = render(<MediaRow title="Aventura" cacheKey="w2-aventura" items={itens(10)} onOpen={() => {}} onSeeAll={() => {}} />);
    chegarPerto();
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(8);
    expect(container.textContent).not.toContain('Ver mais');
    expect(ocioso).toHaveLength(1);
    ficarOcioso();
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(10);
    expect(container.textContent).toContain('Ver mais');
  });

  it('na TV a fileira que já ficou completa remonta completa (o foco pode voltar no 10º cartaz)', () => {
    vi.mocked(isTv).mockReturnValue(true);
    const a = render(<MediaRow title="Fantasia" cacheKey="w2-fantasia" items={itens(10)} onOpen={() => {}} onSeeAll={() => {}} />);
    chegarPerto();
    ficarOcioso();
    a.unmount();
    observadores = [];
    const b = render(<MediaRow title="Fantasia" cacheKey="w2-fantasia" items={itens(10)} onOpen={() => {}} onSeeAll={() => {}} />);
    expect(b.container.querySelectorAll('[data-tv-card]')).toHaveLength(10);
    expect(b.container.textContent).toContain('Ver mais');
    expect(ocioso).toHaveLength(0);
  });

  it('no celular a fileira entra completa, com o "Ver mais"', () => {
    const { container } = render(<MediaRow title="História" items={itens(10)} onOpen={() => {}} onSeeAll={() => {}} />);
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(10);
    expect(container.textContent).toContain('Ver mais');
    expect(ocioso).toHaveLength(0);
  });

  it('carregando: um cartão do tamanho final, sem ícone girando', () => {
    const { container } = render(<MediaRow title="Mistério" cacheKey="w2-misterio" loader={() => new Promise(() => {})} onOpen={() => {}} />);
    const espaco = container.querySelector('[data-fileira-carregando]');
    expect(espaco).not.toBeNull();
    expect(espaco?.className).toContain('w-28');
    expect(espaco?.querySelector('.aspect-\\[2\\/3\\]')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.textContent).toContain('Carregando…');
  });

  it('na TV sem IntersectionObserver monta os cartões (nunca fica vazia)', () => {
    vi.mocked(isTv).mockReturnValue(true);
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<MediaRow title="Terror" cacheKey="w4-terror" items={itens(2)} onOpen={() => {}} />);
    expect(container.querySelectorAll('[data-tv-card]')).toHaveLength(2);
  });
});
