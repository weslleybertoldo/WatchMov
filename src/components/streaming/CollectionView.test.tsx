import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { TmdbCollection, MediaSummary } from '@/lib/tmdb';
import { DESTAQUES, SECOES, UNIVERSOS, carregarColecao, carregarColecoes, idsDe } from '@/lib/colecoes';
import { CollectionCard, CollectionRow, UniversoCard } from './CollectionCard';
import { CollectionView, CollectionsGrid, UniversoView } from './CollectionView';
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

describe('UniversoCard — a pasta Marvel/DC (pasta de pastas)', () => {
  it('nome grande, "N coleções"; foco da TV como cartaz; sem TMDB', () => {
    const onClick = vi.fn();
    render(<UniversoCard universo={UNIVERSOS[0]} onClick={onClick} />);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tv-card');
    expect(btn).toHaveAttribute('data-tv-key', 'uni-marvel');
    expect(btn).not.toHaveAttribute('data-tv-hold');
    expect(screen.getAllByText('Marvel')).toHaveLength(2);   // na capa e embaixo
    expect(screen.getByText(`${UNIVERSOS[0].colecoes.length} coleções`)).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(carregarColecoes).not.toHaveBeenCalled();
  });
});

describe('CollectionRow — fileira "Coleções" no topo da aba Filmes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Marvel e DC primeiro, depois os destaques; tocar abre; "Ver tudo" e "Ver mais" abrem a grade', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([harryPotter, senhor]);
    const onOpen = vi.fn(), onOpenUniverso = vi.fn(), onSeeAll = vi.fn();
    render(<CollectionRow onOpen={onOpen} onOpenUniverso={onOpenUniverso} onSeeAll={onSeeAll} />);
    expect(screen.getByText('Coleções')).toBeInTheDocument();
    // as pastas dos universos aparecem na hora, antes da TMDB responder
    expect([...document.querySelectorAll('[data-universo]')].map(el => el.getAttribute('data-universo'))).toEqual(['marvel', 'dc']);
    await screen.findByText('Harry Potter');
    const pastas = [...document.querySelectorAll('[data-tv-card]')].map(el => el.getAttribute('data-tv-key'));
    expect(pastas).toEqual(['uni-marvel', 'uni-dc', 'col-1241', 'col-119']);
    expect(vi.mocked(carregarColecoes).mock.calls[0][0]).toEqual(DESTAQUES);   // só os 10 destaques
    fireEvent.click(screen.getByText('O Senhor dos Anéis'));
    expect(onOpen).toHaveBeenCalledWith({ id: 119, nome: 'O Senhor dos Anéis' });
    fireEvent.click(document.querySelector('[data-universo="dc"]')!);
    expect(onOpenUniverso).toHaveBeenCalledWith('dc');
    fireEvent.click(screen.getByText('Ver tudo'));
    fireEvent.click(screen.getByText('Ver mais'));
    expect(onSeeAll).toHaveBeenCalledTimes(2);
  });

  it('as pastas vão aparecendo de lote em lote', async () => {
    let terminar: (l: TmdbCollection[]) => void = () => {};
    vi.mocked(carregarColecoes).mockImplementation((_ids, _lote, aoLote) => {
      aoLote?.([harryPotter]);
      return new Promise(r => { terminar = r; });
    });
    render(<CollectionRow onOpen={vi.fn()} onOpenUniverso={vi.fn()} onSeeAll={vi.fn()} />);
    await screen.findByText('Harry Potter');
    expect(screen.queryByText('Ver mais')).toBeNull();   // ainda carregando
    terminar([harryPotter, senhor]);
    await screen.findByText('O Senhor dos Anéis');
    expect(screen.getByText('Ver mais')).toBeInTheDocument();
  });

  it('TMDB fora: ficam só as pastas Marvel e DC', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([]);
    const { container } = render(<CollectionRow onOpen={vi.fn()} onOpenUniverso={vi.fn()} onSeeAll={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Ver mais')).toBeInTheDocument());
    expect(container.querySelectorAll('[data-universo]')).toHaveLength(2);
    expect(container.querySelector('[data-colecao]')).toBeNull();
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

describe('UniversoView — a pasta Marvel aberta', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('as pastas das sagas do universo numa grade; tocar abre a saga', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([harryPotter, senhor]);
    const onOpen = vi.fn(), onBack = vi.fn();
    render(<UniversoView universo={UNIVERSOS[0]} onOpen={onOpen} onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Marvel');
    await screen.findByText('Harry Potter');
    expect(vi.mocked(carregarColecoes).mock.calls[0][0]).toEqual(idsDe(UNIVERSOS[0].colecoes));
    expect(screen.getByText(`${UNIVERSOS[0].colecoes.length} coleções`)).toBeInTheDocument();
    fireEvent.click(screen.getByText('O Senhor dos Anéis'));
    expect(onOpen).toHaveBeenCalledWith({ id: 119, nome: 'O Senhor dos Anéis' });
    fireEvent.click(screen.getAllByRole('button')[0]);   // seta de voltar
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('falhou: avisa e "Tentar de novo" busca outra vez', async () => {
    vi.mocked(carregarColecoes).mockRejectedValueOnce(new Error('TMDB 500')).mockResolvedValueOnce([harryPotter]);
    render(<UniversoView universo={UNIVERSOS[1]} onOpen={vi.fn()} onBack={vi.fn()} />);
    fireEvent.click(await screen.findByText('Tentar de novo'));
    await screen.findByText('Harry Potter');
    expect(carregarColecoes).toHaveBeenCalledTimes(2);
  });
});

describe('CollectionsGrid — "Ver tudo"', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('Universos (Marvel e DC) e uma fileira por gênero, cada uma com as sagas dela', async () => {
    vi.mocked(carregarColecoes).mockResolvedValue([harryPotter, senhor]);
    const onOpen = vi.fn(), onOpenUniverso = vi.fn();
    render(<CollectionsGrid onOpen={onOpen} onOpenUniverso={onOpenUniverso} onBack={vi.fn()} />);
    expect(screen.getByText('Universos')).toBeInTheDocument();
    const fileiras = [...document.querySelectorAll('[data-row-key^="colsec-"]')].map(el => el.getAttribute('data-row-key'));
    expect(fileiras).toEqual(['colsec-universos', ...SECOES.map(s => `colsec-${s.chave}`)]);
    await waitFor(() => expect(carregarColecoes).toHaveBeenCalledTimes(SECOES.length));   // a de Universos não vai na TMDB
    expect(vi.mocked(carregarColecoes).mock.calls.map(c => c[0])).toEqual(SECOES.map(s => idsDe(s.colecoes)));
    fireEvent.click((await screen.findAllByText('Harry Potter'))[0]);
    expect(onOpen).toHaveBeenCalledWith({ id: 1241, nome: 'Harry Potter' });
    fireEvent.click(document.querySelector('[data-universo="marvel"]')!);
    expect(onOpenUniverso).toHaveBeenCalledWith('marvel');
  });

  it('cada fileira só vai na TMDB quando chega perto da tela', async () => {
    const vistos: Array<(es: Array<{ isIntersecting: boolean }>) => void> = [];
    class IOFalso {
      cb: (es: Array<{ isIntersecting: boolean }>) => void;
      constructor(cb: (es: Array<{ isIntersecting: boolean }>) => void) { this.cb = cb; vistos.push(cb); }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', IOFalso);
    try {
      vi.mocked(carregarColecoes).mockResolvedValue([harryPotter]);
      render(<CollectionsGrid onOpen={vi.fn()} onOpenUniverso={vi.fn()} onBack={vi.fn()} />);
      expect(document.querySelectorAll('[data-fileira-reservada]')).toHaveLength(SECOES.length);
      expect(carregarColecoes).not.toHaveBeenCalled();
      act(() => { vistos[0]([{ isIntersecting: true }]); });   // a 1ª fileira de gênero chegou perto
      await screen.findByText('Harry Potter');
      expect(carregarColecoes).toHaveBeenCalledTimes(1);
      expect(vi.mocked(carregarColecoes).mock.calls[0][0]).toEqual(idsDe(SECOES[0].colecoes));
    } finally {
      vi.unstubAllGlobals();
    }
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
