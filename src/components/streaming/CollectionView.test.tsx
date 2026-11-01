import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TmdbCollection, MediaSummary } from '@/lib/tmdb';
import { carregarColecao, carregarColecoes } from '@/lib/colecoes';
import { CollectionCard, CollectionRow } from './CollectionCard';
import { CollectionView, CollectionsGrid } from './CollectionView';
import MediaCard from './MediaCard';

vi.mock('@/lib/device', () => ({ isTv: vi.fn(() => false) }));
vi.mock('@/lib/colecoes', async () => {
  const real = await vi.importActual<typeof import('@/lib/colecoes')>('@/lib/colecoes');
  return {
    ...real,
    carregarColecao: vi.fn(), carregarColecoes: vi.fn(),
    colecaoPronta: vi.fn(() => undefined), colecoesProntas: vi.fn(() => undefined),
  };
});

const filme = (id: number, title: string, date?: string): MediaSummary => ({
  tmdbId: id, title, type: 'movie', date, year: date?.slice(0, 4), posterUrl: `https://image.tmdb.org/t/p/w342/${id}.jpg`,
});
const harryPotter: TmdbCollection = {
  id: 1241, name: 'Harry Potter', overview: 'O menino que sobreviveu.', posterUrl: 'https://image.tmdb.org/t/p/w342/hp.jpg',
  parts: [filme(671, 'A Pedra Filosofal', '2001-11-16'), filme(672, 'A Câmara Secreta', '2002-11-15'), filme(673, 'O Prisioneiro de Azkaban', '2004-05-31')],
};
const senhor: TmdbCollection = { id: 119, name: 'O Senhor dos Anéis', parts: [filme(120, 'A Sociedade do Anel', '2001-12-18')] };

// Coleções (pedido dele 01/11/2026): pastas na aba Filmes; dentro, os filmes na ordem de lançamento.
describe('CollectionCard — a pasta', () => {
  it('capa da coleção, nome, "N filmes"; foco da TV como cartaz, sem o segurar dos favoritos', () => {
    const onClick = vi.fn();
    render(<CollectionCard colecao={harryPotter} onClick={onClick} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tv-card');
    expect(btn).toHaveAttribute('data-tv-key', 'col-1241');
    expect(btn).not.toHaveAttribute('data-tv-hold');
    expect(screen.getByAltText('Harry Potter')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w342/hp.jpg');
    expect(screen.getByText('3 filmes')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('CollectionRow — fileira "Coleções" no topo da aba Filmes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mostra as pastas na ordem; tocar abre a pasta; "Ver tudo" e "Ver mais" abrem a grade', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([harryPotter, senhor]);
    const onOpen = vi.fn(), onSeeAll = vi.fn();
    render(<CollectionRow onOpen={onOpen} onSeeAll={onSeeAll} />);
    expect(screen.getByText('Coleções')).toBeInTheDocument();
    await screen.findByText('Harry Potter');
    const pastas = [...document.querySelectorAll('[data-colecao]')].map(el => el.getAttribute('data-colecao'));
    expect(pastas).toEqual(['1241', '119']);
    expect(vi.mocked(carregarColecoes).mock.calls[0][0]).toHaveLength(10);   // só as 10 da fileira
    fireEvent.click(screen.getByText('O Senhor dos Anéis'));
    expect(onOpen).toHaveBeenCalledWith({ id: 119, nome: 'O Senhor dos Anéis' });
    fireEvent.click(screen.getByText('Ver tudo'));
    fireEvent.click(screen.getByText('Ver mais'));
    expect(onSeeAll).toHaveBeenCalledTimes(2);
  });

  it('TMDB fora: a fileira some', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([]);
    const { container } = render(<CollectionRow onOpen={vi.fn()} onSeeAll={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-row-key="colecoes"]')).toBeNull());
  });
});

describe('CollectionView — a pasta aberta', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('filmes na ordem de lançamento, numerados 1..N, com o período; tocar abre o filme', async () => {
    vi.mocked(carregarColecao).mockResolvedValue(harryPotter);
    const onOpen = vi.fn(), onBack = vi.fn();
    render(<CollectionView colecao={{ id: 1241, nome: 'Harry Potter' }} onOpen={onOpen} onBack={onBack} />);
    await screen.findByText('A Câmara Secreta');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Harry Potter');
    expect(screen.getByText('3 filmes · 2001–2004 · na ordem de lançamento')).toBeInTheDocument();
    expect(screen.getByText('O menino que sobreviveu.')).toBeInTheDocument();
    const cartazes = [...document.querySelectorAll('[data-tv-key^="movie-"]')];
    expect(cartazes.map(el => el.getAttribute('data-tv-key'))).toEqual(['movie-671', 'movie-672', 'movie-673']);
    expect(cartazes.map(el => el.querySelector('span')?.textContent)).toEqual(['1', '2', '3']);
    fireEvent.click(screen.getByText('O Prisioneiro de Azkaban'));
    expect(onOpen).toHaveBeenCalledWith(harryPotter.parts[2]);
    fireEvent.click(screen.getAllByRole('button')[0]);   // seta de voltar
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('falhou: avisa e "Tentar de novo" busca outra vez', async () => {
    vi.mocked(carregarColecao).mockRejectedValueOnce(new Error('TMDB 500')).mockResolvedValueOnce(harryPotter);
    render(<CollectionView colecao={{ id: 1241, nome: 'Harry Potter' }} onOpen={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Tentar de novo'));
    await screen.findByText('A Pedra Filosofal');
    expect(carregarColecao).toHaveBeenCalledTimes(2);
  });
});

describe('CollectionsGrid — "Ver tudo"', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('todas as pastas da lista numa grade', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([harryPotter, senhor]);
    const onOpen = vi.fn();
    render(<CollectionsGrid onOpen={onOpen} onBack={vi.fn()} />);
    await screen.findByText('Harry Potter');
    expect(vi.mocked(carregarColecoes).mock.calls[0][0].length).toBeGreaterThan(10);
    fireEvent.click(screen.getByText('Harry Potter'));
    expect(onOpen).toHaveBeenCalledWith({ id: 1241, nome: 'Harry Potter' });
  });
});

describe('MediaCard numerado', () => {
  it('a tag "Em breve" desce pra baixo do número (não fica em cima dele)', () => {
    render(<MediaCard media={filme(1003596, 'Vingadores: Doutor Destino', '2099-12-16')} rank={5} onClick={() => {}} />);
    const tag = screen.getByText(/breve|estreia|dez/i);
    expect(tag.className).toContain('top-10');
    expect(tag.className).not.toContain('top-1 ');
  });
});
