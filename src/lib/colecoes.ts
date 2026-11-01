// Coleções (pedido dele 01/11/2026): sagas e trilogias numa fileira de pastas no topo da aba Filmes; tocar
// na pasta abre os filmes na ordem de lançamento. IDs de coleção da TMDB, cada um conferido na API em
// 01/11/2026 (GET /collection/{id}: o nome e os filmes bateram). O `nome` daqui é só o reserva — o da tela
// vem da TMDB, em português. A ordem é a da fileira: as 10 primeiras aparecem nela, o resto no "Ver tudo".
import { getCollection, type TmdbCollection } from './tmdb';

export interface ColecaoCurada { id: number; nome: string }

export const COLECOES: ColecaoCurada[] = [
  { id: 86311, nome: 'Vingadores' },
  { id: 1241, nome: 'Harry Potter' },
  { id: 119, nome: 'O Senhor dos Anéis' },
  { id: 10, nome: 'Star Wars' },
  { id: 9485, nome: 'Velozes & Furiosos' },
  { id: 328, nome: 'Jurassic Park' },
  { id: 87359, nome: 'Missão: Impossível' },
  { id: 404609, nome: 'John Wick' },
  { id: 10194, nome: 'Toy Story' },
  { id: 295, nome: 'Piratas do Caribe' },
  // daqui pra baixo, só no "Ver tudo"
  { id: 121938, nome: 'O Hobbit' },
  { id: 263, nome: 'O Cavaleiro das Trevas' },
  { id: 531241, nome: 'Homem-Aranha (Vingadores)' },
  { id: 2344, nome: 'Matrix' },
  { id: 264, nome: 'De Volta para o Futuro' },
  { id: 84, nome: 'Indiana Jones' },
  { id: 2150, nome: 'Shrek' },
  { id: 8354, nome: 'A Era do Gelo' },
  { id: 131635, nome: 'Jogos Vorazes' },
  { id: 33514, nome: 'Crepúsculo' },
  { id: 131292, nome: 'Homem de Ferro' },
  { id: 131295, nome: 'Capitão América' },
  { id: 131296, nome: 'Thor' },
  { id: 284433, nome: 'Guardiões da Galáxia' },
  { id: 86066, nome: 'Meu Malvado Favorito' },
  { id: 14740, nome: 'Madagascar' },
  { id: 1575, nome: 'Rocky' },
  { id: 528, nome: 'O Exterminador do Futuro' },
  { id: 8091, nome: 'Alien' },
  { id: 8650, nome: 'Transformers' },
  { id: 77816, nome: 'Kung Fu Panda' },
  { id: 89137, nome: 'Como Treinar o Seu Dragão' },
];

export const COLECOES_NA_FILEIRA = 10;

// Cache em memória (sobrevive à troca de aba e ao abrir/voltar de um filme): a fileira, a grade do "Ver tudo",
// a pasta aberta e o botão da página do filme leem daqui — a TMDB é consultada uma vez por coleção.
const pedidos = new Map<number, Promise<TmdbCollection>>();
const prontas = new Map<number, TmdbCollection>();

export function carregarColecao(id: number): Promise<TmdbCollection> {
  let p = pedidos.get(id);
  if (!p) {
    p = getCollection(id).then(c => { prontas.set(id, c); return c; });
    pedidos.set(id, p);
    p.catch(() => { pedidos.delete(id); });   // falhou (rede, TMDB fora): a próxima abertura tenta de novo
  }
  return p;
}

// Já carregada nesta abertura do app: a tela monta direto, sem "Carregando…" (e com a mesma altura de antes,
// pro scroll voltar pro mesmo lugar ao sair de um filme).
export function colecaoPronta(id: number): TmdbCollection | undefined {
  return prontas.get(id);
}

// As que não falharam e têm filme, na ordem pedida. De 8 em 8: o "Ver tudo" pede 32 e a Fire TV tem pouca memória.
export async function carregarColecoes(ids: number[], lote = 8): Promise<TmdbCollection[]> {
  const out: (TmdbCollection | null)[] = [];
  for (let i = 0; i < ids.length; i += lote) {
    out.push(...await Promise.all(ids.slice(i, i + lote).map(id => carregarColecao(id).catch(() => null))));
  }
  return out.filter((c): c is TmdbCollection => !!c && c.parts.length > 0);
}

// Todas já prontas? Então devolve na hora (mesma regra do carregarColecoes); senão, undefined.
export function colecoesProntas(ids: number[]): TmdbCollection[] | undefined {
  const lista = ids.map(id => prontas.get(id));
  if (lista.some(c => !c)) return undefined;
  return (lista as TmdbCollection[]).filter(c => c.parts.length > 0);
}

// "2001–2011" (do 1º ao último filme já lançado), ou só "2001" quando é um ano só. Anúncio futuro não estica
// o período (Vingadores fica 2012–2019, não 2012–2027); sem nenhum lançado, vale o que tiver data.
export function anosDaColecao(c: Pick<TmdbCollection, 'parts'>, hoje = new Date().toISOString().slice(0, 10)): string {
  const comData = c.parts.filter(p => p.date && p.year);
  const lancados = comData.filter(p => (p.date as string) <= hoje);
  const anos = (lancados.length ? lancados : comData).map(p => p.year as string).sort();
  if (!anos.length) return '';
  const ini = anos[0], fim = anos[anos.length - 1];
  return ini === fim ? ini : `${ini}–${fim}`;
}

export const filmesLabel = (n: number) => `${n} ${n === 1 ? 'filme' : 'filmes'}`;
