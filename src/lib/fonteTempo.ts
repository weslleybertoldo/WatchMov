// Quanto cada fonte demora pra achar o link (estudo do Nuvio, item 16, 20/10/2026). Cada busca do resolvedor vira um
// registro RESOLVER_TEMPO na tabela da aba Bugs ("fonte=4 · Pomfy resultado=achou ms=31200 …"); a aba mostra só o
// resumo por fonte (os registros não entram nas pastas dos títulos) — é o dado pra ordenar as fontes pela mais rápida.

export const BUSCA_TEMPO = 'RESOLVER_TEMPO';
export type ResultadoBusca = 'achou' | 'nao-tem' | 'estourou';

export function textoDaBusca(o: { fonte: string; resultado: ResultadoBusca; ms: number; extra?: string }): string {
  return `fonte=${o.fonte} resultado=${o.resultado} ms=${Math.max(0, Math.round(o.ms))}${o.extra ? ' ' + o.extra : ''}`;
}

export function lerBusca(cause: string | null | undefined): { fonte: string; resultado: string; ms: number } | null {
  const m = /^fonte=(.+?) resultado=(\S+) ms=(\d+)/.exec(cause ?? '');
  return m ? { fonte: m[1], resultado: m[2], ms: Number(m[3]) } : null;
}

export interface TempoFonte { fonte: string; achou: number; naoTem: number; estourou: number; medianaAchouMs: number | null }

const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Resumo por fonte: quantas vezes achou (e a mediana do tempo), quantas disse que não tem, quantas estourou o prazo.
 *  Ordem: a mais rápida pra achar primeiro; fonte que nunca achou vai pro fim. */
export function tempoDasFontes(rows: { error_name: string | null; error_cause: string | null }[]): TempoFonte[] {
  const por = new Map<string, { achou: number[]; naoTem: number; estourou: number }>();
  for (const r of rows) {
    if (r.error_name !== BUSCA_TEMPO) continue;
    const b = lerBusca(r.error_cause);
    if (!b) continue;
    const f = por.get(b.fonte) ?? { achou: [], naoTem: 0, estourou: 0 };
    if (b.resultado === 'achou') f.achou.push(b.ms);
    else if (b.resultado === 'nao-tem') f.naoTem++;
    else if (b.resultado === 'estourou') f.estourou++;
    por.set(b.fonte, f);
  }
  return [...por.entries()]
    .map(([fonte, f]) => ({ fonte, achou: f.achou.length, naoTem: f.naoTem, estourou: f.estourou, medianaAchouMs: mediana(f.achou) }))
    .sort((a, b) => (a.medianaAchouMs ?? Infinity) - (b.medianaAchouMs ?? Infinity) || a.fonte.localeCompare(b.fonte));
}

/** "31 s" / "1 min 05 s". */
export function fmtTempo(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
