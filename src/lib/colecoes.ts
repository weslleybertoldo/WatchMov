// Coleções (pedido dele 01/11/2026): sagas e trilogias em pastas na aba Filmes; tocar na pasta abre os filmes na
// ordem de lançamento. W5 (pedido dele 01/11/2026 ~20:40: "não tem as trilogias, ex: jogos vorazes, maze runner,
// Batman … tem muito mais coleção" + "universos, em Marvel e DC … a pasta Marvel, clicando dentro terão as pastas dos
// filmes da Marvel"): a lista cresceu e ganhou dois níveis —
//   • UNIVERSOS: Marvel e DC são pastas de PASTAS (as sagas deles moram só lá dentro, não ficam mais soltas);
//   • SECOES: as outras sagas, por gênero, cada gênero uma fileira no "Ver tudo";
//   • DESTAQUES: as sagas da fileira "Coleções" da aba Filmes (depois das pastas Marvel e DC).
// IDs de coleção da TMDB, cada um conferido na API em 01/11/2026 (GET /collection/{id}: nome, filmes e capa).
// O `nome` daqui é só o reserva — o da tela vem da TMDB, em português —, menos quando `fixo`: a TMDB repete o nome
// em sagas diferentes (três "Batman", dois "Homem-Aranha", dois "Superman") ou escreve diferente do que se conhece.
import { getCollection, type TmdbCollection } from './tmdb';

export interface ColecaoCurada { id: number; nome: string; fixo?: true }
export type UniversoId = 'marvel' | 'dc';
export interface Universo { id: UniversoId; nome: string; colecoes: ColecaoCurada[] }
export interface Secao { chave: string; nome: string; colecoes: ColecaoCurada[] }

const c = (id: number, nome: string): ColecaoCurada => ({ id, nome });
const fixo = (id: number, nome: string): ColecaoCurada => ({ id, nome, fixo: true });

export const UNIVERSOS: Universo[] = [
  {
    id: 'marvel', nome: 'Marvel',
    colecoes: [
      c(86311, 'Vingadores'), c(131292, 'Homem de Ferro'), c(131295, 'Capitão América'), c(131296, 'Thor'),
      c(284433, 'Guardiões da Galáxia'), fixo(531241, 'Homem-Aranha (Tom Holland)'), c(422834, 'Homem-Formiga'),
      c(618529, 'Doutor Estranho'), c(529892, 'Pantera Negra'), c(623911, 'Capitã Marvel'), c(448150, 'Deadpool'),
      c(748, 'X-Men'), c(453993, 'Wolverine'), fixo(556, 'Homem-Aranha (Tobey Maguire)'),
      c(125574, 'O Espetacular Homem-Aranha'), c(573436, 'Homem-Aranha: No Aranhaverso'), c(558216, 'Venom'),
      c(9744, 'Quarteto Fantástico'), c(735, 'Blade'), c(90306, 'Motoqueiro Fantasma'), c(635362, 'O Justiceiro'),
    ],
  },
  {
    id: 'dc', nome: 'DC',
    colecoes: [
      fixo(263, 'Batman: O Cavaleiro das Trevas'), fixo(948485, 'The Batman'), fixo(120794, 'Batman (1989–1997)'),
      fixo(1540907, 'Superman (2025)'), c(209131, 'Homem de Aço'), fixo(8537, 'Superman (1978–1987)'),
      c(468552, 'Mulher-Maravilha'), c(573693, 'Aquaman'), c(724848, 'Shazam!'), c(531242, 'Esquadrão Suicida'),
      c(987044, 'Coringa'),
    ],
  },
];

export const SECOES: Secao[] = [
  {
    chave: 'acao', nome: 'Ação',
    colecoes: [
      c(87359, 'Missão: Impossível'), c(404609, 'John Wick'), c(9485, 'Velozes & Furiosos'), c(645, 'James Bond'),
      c(31562, 'Bourne'), c(1570, 'Duro de Matar'), c(5039, 'Rambo'), c(1575, 'Rocky'), c(553717, 'Creed'),
      c(126125, 'Os Mercenários'), c(14890, 'Bad Boys'), c(135483, 'Busca Implacável'), c(9518, 'Carga Explosiva'),
      c(391860, 'Kingsman'), c(945, 'Máquina Mortífera'), c(523855, 'O Protetor'),
      fixo(386534, 'Invasão à Casa Branca'), c(735127, 'Resgate'), c(43064, 'Velocidade Máxima'),
      c(90863, 'A Hora do Rush'), c(2883, 'Kill Bill'), c(52785, 'Triplo X'), c(403374, 'Jack Reacher'),
      fixo(931431, 'Mortal Kombat'), c(70068, 'O Grande Mestre'),
    ],
  },
  {
    chave: 'aventura', nome: 'Aventura',
    colecoes: [
      c(84, 'Indiana Jones'), c(295, 'Piratas do Caribe'), c(1733, 'A Múmia'), c(495527, 'Jumanji'),
      c(531330, 'Top Gun'), fixo(382685, 'Truque de Mestre'), fixo(304, 'Onze Homens e um Segredo'),
      fixo(115776, 'O Código Da Vinci'), c(102322, 'Sherlock Holmes'), c(8580, 'Karatê Kid'), c(8945, 'Mad Max'),
      c(1069584, 'Gladiador'), c(125570, '300'), c(52984, 'A Lenda do Tesouro Perdido'), c(2467, 'Tomb Raider'),
      c(2366, 'Tubarão'), c(1062948, 'Twister'),
    ],
  },
  {
    chave: 'ficcao', nome: 'Ficção científica',
    colecoes: [
      c(10, 'Star Wars'), c(131635, 'Jogos Vorazes'), fixo(1701563, 'Jogos Vorazes: Nova Trilogia'),
      c(295130, 'Maze Runner'), c(283579, 'Divergente'), c(2344, 'Matrix'), c(528, 'O Exterminador do Futuro'),
      c(328, 'Jurassic Park'), c(264, 'De Volta para o Futuro'), c(87096, 'Avatar'), c(726871, 'Duna'),
      c(8091, 'Alien'), c(399, 'Predador'), c(115762, 'Alien vs. Predador'), c(8650, 'Transformers'),
      c(86055, 'MIB: Homens de Preto'), c(115575, 'Star Trek: Realidade Alternativa'), c(422837, 'Blade Runner'), c(63043, 'TRON'),
      c(5547, 'RoboCop'), c(173710, 'Planeta dos Macacos (Reboot)'), c(1709, 'Planeta dos Macacos (Original)'),
      c(535313, 'Godzilla'), c(363369, 'Círculo de Fogo'), c(304378, 'Independence Day'),
      c(2794, 'As Crônicas de Riddick'),
    ],
  },
  {
    chave: 'fantasia', nome: 'Fantasia',
    colecoes: [
      c(1241, 'Harry Potter'), c(435259, 'Animais Fantásticos'), c(119, 'O Senhor dos Anéis'), c(121938, 'O Hobbit'),
      c(420, 'As Crônicas de Nárnia'), c(179919, 'Percy Jackson'), c(33514, 'Crepúsculo'), c(2326, 'Anjos da Noite'),
      c(531331, 'Malévola'), c(261307, 'Alice no País das Maravilhas'), c(968080, 'Wicked'),
      c(527439, 'Mary Poppins'), c(85943, 'Uma Noite no Museu'), c(2980, 'Os Caça-Fantasmas'), c(720879, 'Sonic'),
      c(488924, 'As Aventuras de Paddington'), c(1458864, 'Como Treinar o Seu Dragão (Live-Action)'),
      c(751156, 'Abracadabra'), c(531799, 'Encantada'),
    ],
  },
  {
    chave: 'animacao', nome: 'Animação',
    colecoes: [
      c(10194, 'Toy Story'), c(2150, 'Shrek'), c(8354, 'A Era do Gelo'), c(86066, 'Meu Malvado Favorito'),
      c(544669, 'Minions'), c(14740, 'Madagascar'), c(77816, 'Kung Fu Panda'), c(89137, 'Como Treinar o Seu Dragão'),
      c(137697, 'Procurando Nemo'), c(468222, 'Os Incríveis'), c(137696, 'Monstros S.A.'), c(87118, 'Carros'),
      c(1022790, 'Divertida Mente'), c(386382, 'Frozen'), c(404825, 'Detona Ralph'), c(1084247, 'Zootopia'),
      c(1241984, 'Moana'), c(185103, 'Hotel Transilvânia'), c(464577, 'Os Croods'), c(229932, 'Rio'),
      fixo(427084, 'Pets: A Vida Secreta dos Bichos'), c(544670, 'Sing'), c(94032, 'O Rei Leão'),
      fixo(762512, 'O Rei Leão (live-action)'), c(97461, 'Lilo & Stitch'), c(94602, 'Gato de Botas'),
      c(167613, 'Alvin e os Esquilos'), c(275402, 'Bob Esponja'), c(489724, 'Trolls'), c(722961, 'Space Jam'),
    ],
  },
  {
    chave: 'animes', nome: 'Animes',
    colecoes: [
      c(425164, 'Dragon Ball Z'), c(620873, 'Dragon Ball Super'), c(386410, 'Dragon Ball'), c(23616, 'Naruto'),
      c(23456, 'One Piece'), c(925155, 'Demon Slayer'), c(1529614, 'Jujutsu Kaisen'), c(1189668, 'My Hero Academia'),
      fixo(383987, 'Ataque dos Titãs'), c(109079, 'Os Cavaleiros do Zodíaco'), c(34055, 'Pokémon'),
      c(210303, 'Rebuild of Evangelion'), c(600207, 'Yu-Gi-Oh!'), c(39244, 'Digimon Adventure'),
      c(39199, 'Detetive Conan'), c(263101, 'Sailor Moon'),
    ],
  },
  {
    chave: 'terror', nome: 'Terror',
    colecoes: [
      c(313086, 'Invocação do Mal'), c(402074, 'Annabelle'), c(968052, 'A Freira'), c(228446, 'Sobrenatural'),
      c(656, 'Jogos Mortais'), c(8864, 'Premonição'), c(2602, 'Pânico'), c(477962, 'IT: A Coisa'),
      c(521226, 'Um Lugar Silencioso'), c(12263, 'O Exorcista'), c(91361, 'Halloween'), c(8581, 'A Hora do Pesadelo'),
      c(9735, 'Sexta-Feira 13'), c(111751, 'O Massacre da Serra Elétrica'), c(10455, 'Brinquedo Assassino'),
      c(41437, 'Atividade Paranormal'), c(256322, 'Uma Noite de Crime'), c(727761, 'Terrifier'),
      c(14563, 'O Chamado'), c(1960, 'Uma Noite Alucinante'), c(1565, 'Extermínio'), c(790370, 'Rua do Medo'),
      c(1071588, 'M3GAN'), c(1100788, 'Sorria'), c(17255, 'Resident Evil'),
      c(1240438, "Five Nights at Freddy's"), c(526380, 'A Morte Te Dá Parabéns'), c(748919, 'O Homem nas Trevas'),
    ],
  },
  {
    chave: 'comedia', nome: 'Comédia',
    colecoes: [
      c(86119, 'Se Beber, Não Case!'), c(2806, 'American Pie'), c(4246, 'Todo Mundo em Pânico'),
      c(9888, 'Esqueceram de Mim'), c(180546, 'Gente Grande'), c(51509, 'Entrando Numa Fria'),
      c(96665, 'Debi & Lóide'), c(266672, 'Ted'), c(1125292, 'Sexta-Feira Muito Louca'), c(1006, 'Austin Powers'),
      c(37139, 'Corra que a Polícia Vem Aí!'), c(3167, 'Ace Ventura'), c(9338, 'Loucademia de Polícia'),
      c(487376, 'Perfeita é a Mãe'), c(280588, 'Quero Matar Meu Chefe'), c(44979, 'Vovó... Zona'),
      c(86117, 'Johnny English'), c(103372, 'Mr. Bean'), c(937, 'A Pantera Cor-de-Rosa'), c(86024, 'Legalmente Loira'),
      c(99606, 'Meninas Malvadas'), c(212562, 'Anjos da Lei'), c(86486, 'Pequenos Espiões'), c(168880, 'Beethoven'),
      c(99727, 'Stuart Little'), c(86110, 'Diário de Um Banana'),
    ],
  },
  {
    chave: 'romance', nome: 'Romance e drama',
    colecoes: [
      c(230, 'O Poderoso Chefão'), c(344830, 'Cinquenta Tons'), c(702624, 'After'), fixo(1156666, 'Minha Culpa'),
      c(726619, 'A Barraca do Beijo'), c(569738, 'Para Todos os Garotos'), c(1130226, 'Através da Minha Janela'),
      c(107674, 'O Diário da Princesa'), c(458558, 'Mamma Mia!'), c(8936, 'Bridget Jones'),
      c(1314623, 'O Diabo Veste Prada'), fixo(50457, 'Sex and the City'), c(86092, 'Ela Dança, Eu Danço'),
      c(328247, 'Magic Mike'), c(86058, 'Dirty Dancing'), c(86083, 'Grease'), c(87253, 'High School Musical'),
      c(466463, 'Descendentes'), c(306031, 'A Escolha Perfeita'), c(437451, 'A Nova Cinderela'),
    ],
  },
  {
    chave: 'nacionais', nome: 'Nacionais',
    colecoes: [
      c(119581, 'Tropa de Elite'), c(455278, 'Minha Mãe é uma Peça'), c(1219938, 'O Auto da Compadecida'),
      c(743415, 'De Pernas pro Ar'), fixo(342577, 'Até que a Sorte nos Separe'), c(369380, 'Se Eu Fosse Você'),
      c(646622, 'Os Normais'), c(536206, 'Os Penetras'), c(809460, 'Turma da Mônica'),
      c(666935, 'Detetives do Prédio Azul'),
    ],
  },
];

// Fileira "Coleções" da aba Filmes: depois das pastas Marvel e DC, estas sagas (Jogos Vorazes e Maze Runner ele citou).
export const DESTAQUES: number[] = [1241, 131635, 295130, 119, 10, 9485, 328, 87359, 404609, 295];

export const idsDe = (l: ColecaoCurada[]) => l.map(x => x.id);
export const universoPorId = (id: UniversoId) => UNIVERSOS.find(u => u.id === id);

const NOME_FIXO = new Map<number, string>(
  [...UNIVERSOS.flatMap(u => u.colecoes), ...SECOES.flatMap(s => s.colecoes)].filter(x => x.fixo).map(x => [x.id, x.nome]),
);

// Cache em memória (sobrevive à troca de aba e ao abrir/voltar de um filme): as fileiras, as pastas Marvel/DC, a
// pasta aberta e o botão da página do filme leem daqui — a TMDB é consultada uma vez por coleção.
const pedidos = new Map<number, Promise<TmdbCollection>>();
const prontas = new Map<number, TmdbCollection>();

export function carregarColecao(id: number): Promise<TmdbCollection> {
  let p = pedidos.get(id);
  if (!p) {
    p = getCollection(id).then(col => {
      const nome = NOME_FIXO.get(id);
      const pronta = nome ? { ...col, name: nome } : col;
      prontas.set(id, pronta);
      return pronta;
    });
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

const valida = (col: TmdbCollection | null | undefined): col is TmdbCollection => !!col && col.parts.length > 0;

// As que não falharam e têm filme, na ordem pedida. De 8 em 8 (a Fire TV tem pouca memória); `aoLote` recebe a
// lista parcial a cada lote, pra tela ir mostrando as pastas sem esperar a fileira inteira.
export async function carregarColecoes(
  ids: number[], lote = 8, aoLote?: (parcial: TmdbCollection[]) => void,
): Promise<TmdbCollection[]> {
  const out: (TmdbCollection | null)[] = [];
  for (let i = 0; i < ids.length; i += lote) {
    out.push(...await Promise.all(ids.slice(i, i + lote).map(id => carregarColecao(id).catch(() => null))));
    if (aoLote && i + lote < ids.length) aoLote(out.filter(valida));
  }
  return out.filter(valida);
}

// Todas já prontas? Então devolve na hora (mesma regra do carregarColecoes); senão, undefined.
export function colecoesProntas(ids: number[]): TmdbCollection[] | undefined {
  const lista = ids.map(id => prontas.get(id));
  if (lista.some(x => !x)) return undefined;
  return (lista as TmdbCollection[]).filter(valida);
}

// "2001–2011" (do 1º ao último filme já lançado), ou só "2001" quando é um ano só. Anúncio futuro não estica
// o período (Vingadores fica 2012–2019, não 2012–2027); sem nenhum lançado, vale o que tiver data.
export function anosDaColecao(col: Pick<TmdbCollection, 'parts'>, hoje = new Date().toISOString().slice(0, 10)): string {
  const comData = col.parts.filter(p => p.date && p.year);
  const lancados = comData.filter(p => (p.date as string) <= hoje);
  const anos = (lancados.length ? lancados : comData).map(p => p.year as string).sort();
  if (!anos.length) return '';
  const ini = anos[0], fim = anos[anos.length - 1];
  return ini === fim ? ini : `${ini}–${fim}`;
}

export const filmesLabel = (n: number) => `${n} ${n === 1 ? 'filme' : 'filmes'}`;
export const colecoesLabel = (n: number) => `${n} ${n === 1 ? 'coleção' : 'coleções'}`;
