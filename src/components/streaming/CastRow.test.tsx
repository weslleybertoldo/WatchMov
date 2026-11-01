import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CastRow, { ELENCO_TV } from './CastRow';
import { getCredits } from '@/lib/tmdb';
import { isTv } from '@/lib/device';

vi.mock('@/lib/device', () => ({ isTv: vi.fn(() => false) }));
vi.mock('@/lib/tmdb', () => ({ getCredits: vi.fn() }));

const pessoas = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: i, name: `Pessoa ${i}`, character: `Papel ${i}`, profileUrl: i === 0 ? undefined : `https://image.tmdb.org/t/p/w185/p${i}.jpg`,
}));

// Elenco na página do título (pedido dele 01/11/2026, foto aprovada).
describe('CastRow', () => {
  beforeEach(() => { vi.mocked(isTv).mockReturnValue(false); });

  it('mostra "Elenco" com foto, nome e personagem; sem foto, as iniciais', async () => {
    vi.mocked(getCredits).mockResolvedValue(pessoas(3));
    render(<CastRow tmdbId={39254} type="movie" />);
    expect(await screen.findByText('Elenco')).toBeInTheDocument();
    expect(screen.getByText('Pessoa 1')).toBeInTheDocument();
    expect(screen.getByText('Papel 1')).toBeInTheDocument();
    expect(screen.getByAltText('Pessoa 1')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/p1.jpg');
    expect(screen.getByText('P0')).toBeInTheDocument();   // "Pessoa 0" sem foto
  });

  it('sem elenco (ou TMDB fora) a seção não aparece', async () => {
    vi.mocked(getCredits).mockRejectedValue(new Error('TMDB 500'));
    const { container } = render(<CastRow tmdbId={1} type="tv" />);
    await waitFor(() => expect(getCredits).toHaveBeenCalled());
    expect(container.querySelector('[data-elenco]')).toBeNull();
  });

  it('na TV mostra só quem cabe na tela', async () => {
    vi.mocked(isTv).mockReturnValue(true);
    vi.mocked(getCredits).mockResolvedValue(pessoas(15));
    render(<CastRow tmdbId={2} type="movie" />);
    await screen.findByText('Elenco');
    expect(screen.getAllByText(/^Pessoa \d+$/)).toHaveLength(ELENCO_TV);
  });
});
