// Rótulo de qualidade pela CLASSE da imagem, não pela altura crua (09/11/2026, pedido do Weslley: o player mostrava
// "804p" num filme que o site chama de 1080p). Filme de cinema vem sem as faixas pretas — 1920 × 804 é o Full HD
// dele —, então a classe é a altura que a imagem teria numa tela 16:9: max(lado menor, lado maior × 9/16), encaixada
// no degrau padrão mais perto (até 7%: 2048 × 1080 e 4096 × 2160 de cinema digital seguem 1080p e 2160p).
// Só RÓTULO: escolher a faixa e ordenar os links continuam pela altura/área de verdade.
// Mesma regra do QualidadeDaImagem.java (APK) e do `classeDaImagem` de desktop/regrasCaptura.ts (app do Windows).

const DEGRAUS = [144, 240, 360, 480, 540, 576, 720, 1080, 1440, 2160, 4320];
const FOLGA = 0.07;

/** Classe da imagem (1920×804 → 1080). Largura desconhecida (≤ 0) = só a altura. 0 = sem altura. */
export function classeDaImagem(largura: number | undefined, altura: number | undefined): number {
  const h = altura ?? 0;
  const w = largura ?? 0;
  if (!(h > 0)) return 0;
  const equivalente = w > 0 ? Math.max(Math.min(w, h), (Math.max(w, h) * 9) / 16) : h;
  let perto = DEGRAUS[0];
  for (const d of DEGRAUS) if (Math.abs(d - equivalente) < Math.abs(perto - equivalente)) perto = d;
  return Math.abs(perto - equivalente) <= perto * FOLGA ? perto : Math.round(equivalente);
}

/** "1080p"; vazio sem altura. */
export function qualidadeDaImagem(largura: number | undefined, altura: number | undefined): string {
  const c = classeDaImagem(largura, altura);
  return c > 0 ? `${c}p` : '';
}
