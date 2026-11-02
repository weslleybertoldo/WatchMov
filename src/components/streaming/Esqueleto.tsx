// W4 do raio-x (02/11/2026, Skill-wbs-navegacao): esqueleto PARADO no lugar do spinner — cartões e blocos do tamanho
// final, então a tela não pula quando o conteúdo chega. No celular pulsa de leve; na TV fica parado (html.tv
// .animate-pulse). A barra de cima e a de baixo continuam na tela (a casca não some).

const bloco = 'bg-muted/40 animate-pulse';

export function EsqueletoGrade({ n = 12 }: { n?: number }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3" data-esqueleto aria-busy="true" aria-label="Carregando">
      {Array.from({ length: n }, (_, i) => <div key={i} className={`rounded-lg aspect-[2/3] ${bloco}`} />)}
    </div>
  );
}

// Tela que ainda está baixando (Suspense da camada): o cabeçalho dela (voltar + título) e a grade.
export function EsqueletoTela() {
  return (
    <div className="space-y-4" data-esqueleto-tela aria-busy="true">
      <div className="flex items-center gap-2">
        <div className={`h-9 w-9 rounded-md ${bloco}`} />
        <div className={`h-6 w-40 rounded-md ${bloco}`} />
      </div>
      <EsqueletoGrade n={9} />
    </div>
  );
}

// Página do título que ainda está baixando: o fundo, o nome, a linha de botões e a sinopse.
export function EsqueletoTitulo() {
  return (
    <div className="space-y-4" data-esqueleto-tela aria-busy="true">
      <div className={`-mx-4 md:-mx-6 -mt-4 aspect-video max-h-[46vh] ${bloco}`} />
      <div className={`h-7 w-2/3 rounded-md ${bloco}`} />
      <div className="flex gap-2">
        <div className={`h-10 flex-1 rounded-md ${bloco}`} />
        <div className={`h-10 w-10 rounded-md ${bloco}`} />
        <div className={`h-10 w-10 rounded-md ${bloco}`} />
      </div>
      <div className="space-y-2">
        <div className={`h-3 w-full rounded ${bloco}`} />
        <div className={`h-3 w-5/6 rounded ${bloco}`} />
        <div className={`h-3 w-4/6 rounded ${bloco}`} />
      </div>
    </div>
  );
}

// Fileira de cartazes (Início) — o mesmo tamanho dos cartões da MediaRow.
function EsqueletoFileira() {
  return (
    <div className="space-y-2">
      <div className={`h-5 w-44 rounded-md ${bloco}`} />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className={`shrink-0 w-28 sm:w-32 rounded-lg aspect-[2/3] ${bloco}`} />)}
      </div>
    </div>
  );
}

// Primeira abertura (a biblioteca ainda vem do banco): a casca do app — barra de cima, destaque e fileiras — no lugar
// do spinner de tela cheia.
export function EsqueletoInicio() {
  return (
    <div className="min-h-screen bg-background flex flex-col" data-esqueleto-inicio aria-busy="true">
      <header className="sticky top-0 z-40 bg-background border-b border-border/50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/logo-topo.png" alt="WatchMov" width={28} height={28} className="h-7 w-7" />
          <div className="flex items-center gap-2">
            <div className={`h-8 w-8 rounded-md ${bloco}`} />
            <div className={`h-8 w-8 rounded-md ${bloco}`} />
            <div className={`h-8 w-8 rounded-md ${bloco}`} />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 md:px-6 py-4 space-y-6">
        <div className={`-mx-4 md:-mx-6 -mt-2 aspect-video max-h-[46vh] md:aspect-auto md:h-[46vh] ${bloco}`} />
        <EsqueletoFileira />
        <EsqueletoFileira />
      </main>
    </div>
  );
}
