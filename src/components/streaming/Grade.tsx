import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { isTv } from '@/lib/device';
import { useTelaVisivel } from '@/lib/telas';
import { devolverFoco } from '@/lib/tvNav';
import { GRADE_CLASSES, alturaDasLinhas, faixaDaJanela, linhaNaAltura, palpiteDeAltura } from '@/lib/gradeJanela';

// W5 do raio-x de fluidez (02/11/2026): grades longas na TV. O "Ver tudo" cresce 20 cartazes por página, o Procurar
// também, e Favoritos, Histórico, Continuar, Busca e Ao Vivo mostram a lista inteira. Na TV (1 GB) cada cartaz montado
// custa nós na página, a capa decodificada (~0,7 MB numa w342) e a medida a cada seta. Aqui a grade da TV monta só as
// linhas perto do foco (a linha focada ± JANELA_TV); as de cima e as de baixo viram espaço vazio da MESMA altura
// (padding da grade), então a página não pula e a memória de rolagem da W3 continua valendo. No celular a grade é a de
// sempre, inteira.

const CONTENTS = { display: 'contents' } as const;

// Colunas da GRADE_CLASSES pela largura (o 1º desenho, antes de medir: md = 6, sm = 4, senão 3).
function colunasPelaLargura(): number {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  return w >= 768 ? 6 : w >= 640 ? 4 : 3;
}

interface GradeProps<T> {
  itens: readonly T[];
  chave: (item: T) => string;
  children: (item: T, i: number) => ReactNode;
  className?: string;
}

export default function Grade<T>({ className = GRADE_CLASSES, ...props }: GradeProps<T>) {
  if (!isTv()) {
    const { itens, chave, children } = props;
    return <div className={className}>{itens.map((m, i) => <Fragment key={chave(m)}>{children(m, i)}</Fragment>)}</div>;
  }
  return <GradeDaTv className={className} {...props} />;
}

function GradeDaTv<T>({ itens, chave, children, className }: GradeProps<T> & { className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const visivel = useTelaVisivel();
  const [colunas, setColunas] = useState(colunasPelaLargura);
  const [ancora, setAncora] = useState(0);
  const [, redesenhar] = useState(0);
  const [medidas] = useState(() => new Map<number, number>());   // altura de cada linha que já passou pela tela
  const vao = useRef(12);

  const linhas = Math.ceil(itens.length / colunas);
  const [ini, fim] = faixaDaJanela(ancora, linhas);
  const palpite = palpiteDeAltura(medidas);
  const acima = alturaDasLinhas(0, ini - 1, medidas, palpite, vao.current);
  const abaixo = alturaDasLinhas(fim + 1, linhas - 1, medidas, palpite, vao.current);
  const atual = useRef({ ancora, ini, fim, linhas, palpite });
  atual.current = { ancora, ini, fim, linhas, palpite };
  const adiado = useRef<{ raf: number; t?: ReturnType<typeof setTimeout> }>({ raf: 0 });
  const cancelarAdiado = () => { cancelAnimationFrame(adiado.current.raf); clearTimeout(adiado.current.t); };
  useEffect(() => cancelarAdiado, []);

  // Depois de CADA desenho (antes de pintar): colunas, vão e a altura de cada linha montada. Mudou alguma = o espaço vazio
  // de cima/baixo é refeito com a medida certa (a linha que sai da janela deixa exatamente a altura dela). Só redesenha
  // quando a conta muda: linha nova com a altura do palpite não muda nada (as linhas da grade costumam ser iguais).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !el.getClientRects().length) return;          // escondida: mede quando aparecer
    const st = getComputedStyle(el);
    const cols = st.gridTemplateColumns.split(' ').filter(Boolean).length;
    if (cols && cols !== colunas) { setColunas(cols); return; }
    let mudou = false;
    const gap = parseFloat(st.rowGap) || 0;
    if (Math.abs(gap - vao.current) > 0.5) { vao.current = gap; mudou = true; }
    const topo = new Map<number, number>();
    const fundo = new Map<number, number>();
    for (let k = 0; k < el.children.length; k++) {
      const item = el.children[k].firstElementChild;
      if (!item) continue;
      const r = item.getBoundingClientRect();
      const linha = ini + Math.floor(k / colunas);
      topo.set(linha, Math.min(topo.get(linha) ?? Infinity, r.top));
      fundo.set(linha, Math.max(fundo.get(linha) ?? -Infinity, r.bottom));
    }
    const usado = atual.current.palpite;
    topo.forEach((t, linha) => {
      const h = fundo.get(linha)! - t;
      const antes = medidas.get(linha);
      if (h <= 0 || (antes !== undefined && Math.abs(antes - h) <= 0.5)) return;
      medidas.set(linha, h);
      if (Math.abs((antes ?? usado) - h) > 0.5) mudou = true;
    });
    if (mudou) redesenhar(v => v + 1);
  });

  // Foco num cartaz da grade = a janela anda junto. A linha de cima e a de baixo do foco precisam estar montadas JÁ (a
  // próxima seta vai pra elas); estando, a janela anda logo DEPOIS de a tela mostrar o foco novo — a tecla não espera
  // montar a linha que entra lá embaixo, fora da tela (medido: ↓ 31–37 → 106–113 ms na CPU 4× quando andava junto).
  const aoFocar = (e: FocusEvent<HTMLDivElement>) => {
    const w = (e.target as Element).closest('[data-grade-i]');
    if (!w || w.parentElement !== ref.current) return;
    const a = Math.floor(Number(w.getAttribute('data-grade-i')) / colunas);
    const { ancora: atualA, ini: de, fim: ate, linhas: n } = atual.current;
    cancelarAdiado();
    if (a === atualA) return;
    if ((a > 0 && a - 1 < de) || (a < n - 1 && a + 1 > ate)) { setAncora(a); return; }
    adiado.current.raf = requestAnimationFrame(() => { adiado.current.t = setTimeout(() => setAncora(a), 0); });
  };

  // Foco FORA da grade (barra de cima, filtros, "Carregar mais", aba guardada que voltou): a janela segue o que está na
  // tela, pra nunca sobrar um buraco vazio onde a página está mostrando.
  const conferirTela = useCallback(() => {
    const el = ref.current;
    if (!el || !el.getClientRects().length || el.contains(document.activeElement)) return;
    const { ini: de0, fim: ate0, linhas: n, palpite: p } = atual.current;
    if (n <= 0) return;
    const caixa = el.getBoundingClientRect();
    const de = linhaNaAltura(-caixa.top, n, medidas, p, vao.current);
    const ate = linhaNaAltura(window.innerHeight - caixa.top, n, medidas, p, vao.current);
    if (de >= de0 && ate <= ate0) return;
    flushSync(() => setAncora(Math.round((de + ate) / 2)));
    devolverFoco();   // só age com o foco perdido (tela que voltou montada de novo): vai pro cartaz lembrado ou o 1º à vista
  }, [medidas]);

  useEffect(() => {
    window.addEventListener('scroll', conferirTela, { passive: true });
    return () => window.removeEventListener('scroll', conferirTela);
  }, [conferirTela]);
  // A tela guardada reapareceu: confere depois de a página recolocar a rolagem e o foco (o Index faz isso antes).
  useEffect(() => {
    if (!visivel) return;
    const raf = requestAnimationFrame(conferirTela);
    return () => cancelAnimationFrame(raf);
  }, [visivel, conferirTela]);

  const primeiro = ini * colunas;
  const montados = fim >= ini ? itens.slice(primeiro, (fim + 1) * colunas) : [];
  return (
    <div ref={ref} className={className} onFocus={aoFocar} data-grade-tv="" data-grade-n={itens.length}
      style={{ paddingTop: acima, paddingBottom: abaixo }}>
      {montados.map((m, k) => (
        <div key={chave(m)} data-grade-i={primeiro + k} style={CONTENTS}>{children(m, primeiro + k)}</div>
      ))}
    </div>
  );
}
