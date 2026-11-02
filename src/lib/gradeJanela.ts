// W5 do raio-x de fluidez (02/11/2026): as contas da grade em janela da TV (src/components/streaming/Grade.tsx). Na TV a
// grade monta só as linhas perto do foco; as de fora viram espaço vazio com a altura delas (medida, ou o palpite).

export const GRADE_CLASSES = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3';
export const JANELA_TV = 3;          // linhas montadas acima e abaixo da linha do foco (a tela da TV mostra ~2,5)
const ALTURA_PALPITE = 230;          // linha que ainda não passou pela tela (cartaz da TV: capa de 192 px + 2 linhas)

/** Linhas montadas: a do foco ± janela, sem passar das pontas. Sem linhas = faixa vazia ([0, -1]). */
export function faixaDaJanela(ancora: number, linhas: number, janela = JANELA_TV): [number, number] {
  if (linhas <= 0) return [0, -1];
  const a = Math.min(Math.max(0, Math.floor(ancora)), linhas - 1);
  return [Math.max(0, a - janela), Math.min(linhas - 1, a + janela)];
}

/** Média das linhas já medidas — o palpite das que ainda não passaram pela tela. */
export function palpiteDeAltura(medidas: ReadonlyMap<number, number>, padrao = ALTURA_PALPITE): number {
  if (!medidas.size) return padrao;
  let soma = 0;
  medidas.forEach(v => { soma += v; });
  return soma / medidas.size;
}

/** Altura que as linhas [de, ate] ocupam na grade: cada uma + o vão até a próxima. */
export function alturaDasLinhas(de: number, ate: number, medidas: ReadonlyMap<number, number>, palpite: number, vao: number): number {
  let soma = 0;
  for (let r = Math.max(0, de); r <= ate; r++) soma += (medidas.get(r) ?? palpite) + vao;
  return soma;
}

/** Linha que fica na altura y (px a partir do topo da grade); acima da grade = a 1ª, abaixo = a última. */
export function linhaNaAltura(y: number, linhas: number, medidas: ReadonlyMap<number, number>, palpite: number, vao: number): number {
  if (linhas <= 0) return 0;
  let topo = 0;
  for (let r = 0; r < linhas; r++) {
    const fundo = topo + (medidas.get(r) ?? palpite);
    if (y < fundo + vao / 2) return r;
    topo = fundo + vao;
  }
  return linhas - 1;
}
