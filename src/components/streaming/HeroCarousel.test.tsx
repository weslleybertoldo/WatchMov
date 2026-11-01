import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import HeroCarousel from './HeroCarousel';
import { isTv } from '@/lib/device';

vi.mock('@/lib/device', () => ({ isTv: vi.fn(() => false) }));
vi.mock('@/hooks/use-pagina-visivel', () => ({ usePaginaVisivel: () => true }));
vi.mock('@/lib/tmdb', () => ({
  trendingToday: vi.fn(() => Promise.resolve([
    { type: 'movie', tmdbId: 1, title: 'Primeiro', backdropUrl: 'https://image.tmdb.org/t/p/w1280/a.jpg' },
    { type: 'movie', tmdbId: 2, title: 'Segundo', backdropUrl: 'https://image.tmdb.org/t/p/w1280/b.jpg' },
    { type: 'movie', tmdbId: 3, title: 'Terceiro', backdropUrl: 'https://image.tmdb.org/t/p/w1280/c.jpg' },
  ])),
}));

const titulo = () => screen.getByRole('heading', { level: 2 }).textContent;

// W4 das quedas na Fire TV (01/11/2026): na TV o destaque não gira sozinho; as setas continuam trocando.
describe('HeroCarousel — carrossel parado na TV', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.mocked(isTv).mockReturnValue(false); });
  afterEach(() => { vi.useRealTimers(); });

  it('no celular gira sozinho a cada 5 s (como antes)', async () => {
    render(<HeroCarousel onOpen={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(titulo()).toBe('Primeiro');
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(titulo()).toBe('Segundo');
  });

  it('na TV fica parado; a seta → no destaque troca', async () => {
    vi.mocked(isTv).mockReturnValue(true);
    render(<HeroCarousel onOpen={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(titulo()).toBe('Primeiro');
    await act(async () => { vi.advanceTimersByTime(20000); });
    expect(titulo()).toBe('Primeiro');
    const destaque = document.querySelector('[data-row-key="hero"]') as HTMLElement;
    await act(async () => { destaque.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(titulo()).toBe('Segundo');
  });
});
