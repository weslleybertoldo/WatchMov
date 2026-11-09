// Regras das quedas do app do Windows que vão pra aba Bugs (W6, plano 07/11/2026) — o AppExitLog.java do APK.
// Sem Electron aqui: testadas em regrasFalhas.test.cjs (npm run testar).

/** Um fechamento/queda guardado pelo PC, no mesmo formato do APK (`AppExit` do nativePlayer.ts). */
export interface Falha { ts: number; reason: number; cause: string }

// Mesmos códigos do ApplicationExitInfo do Android (a aba Bugs já mostra assim): 2 sinal, 3 memória, 4 erro no app,
// 5 erro nativo, 6 travou, 13 sistema.
export const MOTIVO = { SINAL: 2, MEMORIA: 3, ERRO_APP: 4, ERRO_NATIVO: 5, TRAVOU: 6, SISTEMA: 13 } as const;

/** Até quantas ficam guardadas esperando a aba Bugs (sem sessão por muito tempo, a mais velha sai). */
export const MAX_FALHAS = 50;

const NOME_DO_PROCESSO: Record<string, string> = {
  GPU: 'Processo de vídeo (GPU)',
  Utility: 'Processo auxiliar',
  'Pepper Plugin': 'Plugin',
  'Pepper Plugin Broker': 'Plugin',
  Unknown: 'Processo',
};

/** `render-process-gone` (a janela) ou `child-process-gone` (GPU, rede, áudio…) → motivo + texto. `clean-exit` = null. */
export function falhaDoProcesso(qual: 'janela' | 'filho', d: { reason?: string; exitCode?: number; type?: string; serviceName?: string; name?: string }, ts: number): Falha | null {
  const r = d.reason ?? '';
  if (!r || r === 'clean-exit') return null;
  const reason = r === 'oom' ? MOTIVO.MEMORIA
    : r === 'crashed' ? MOTIVO.ERRO_NATIVO
      : r === 'killed' ? MOTIVO.SINAL
        : r === 'launch-failed' || r === 'integrity-failure' ? MOTIVO.ERRO_APP
          : MOTIVO.SISTEMA;
  const quem = qual === 'janela' ? 'A janela do app'
    : (d.type === 'Utility' && (d.name || d.serviceName)) ? `Processo auxiliar (${d.name || d.serviceName})`
      : NOME_DO_PROCESSO[d.type ?? 'Unknown'] ?? `Processo ${d.type}`;
  const como = r === 'oom' ? 'caiu por falta de memória'
    : r === 'crashed' ? 'caiu (erro)'
      : r === 'killed' ? 'foi fechado pelo sistema'
        : r === 'launch-failed' ? 'não conseguiu abrir'
          : r === 'integrity-failure' ? 'falhou na verificação do Windows'
            : `fechou (${r})`;
  const codigo = typeof d.exitCode === 'number' && d.exitCode !== 0 ? ` · código ${d.exitCode}` : '';
  return { ts, reason, cause: `${quem} ${como}${codigo}` };
}

/** A janela parou de responder (o Windows mostraria "Não está respondendo") = o ANR do Android. */
export const falhaTravou = (ts: number): Falha => ({ ts, reason: MOTIVO.TRAVOU, cause: 'A janela do app travou (não respondeu)' });

/** Erro solto do processo principal (`uncaughtException`/`unhandledRejection`): a 1ª linha da pilha basta. */
export function falhaDoErro(e: unknown, ts: number): Falha {
  const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { ts, reason: MOTIVO.ERRO_APP, cause: `Erro no app: ${texto.split('\n')[0].slice(0, 300)}` };
}

/** Junta a nova no fim (mais velha primeiro, como o APK manda) e corta as mais velhas além de MAX_FALHAS. */
export function juntarFalha(lista: Falha[], nova: Falha): Falha[] {
  return [...lista, nova].sort((a, b) => a.ts - b.ts).slice(-MAX_FALHAS);
}

/** A aba Bugs confirmou até `ts`: sai tudo até ele (as que chegaram depois ficam). */
export const confirmarAte = (lista: Falha[], ts: number): Falha[] => lista.filter((f) => f.ts > ts);

/** Arquivo lido do disco → só as entradas válidas (arquivo velho, mexido ou cortado não derruba nada). */
export function lerFalhas(texto: string): Falha[] {
  try {
    const j: unknown = JSON.parse(texto);
    if (!Array.isArray(j)) return [];
    return j.filter((f): f is Falha => !!f && typeof f.ts === 'number' && typeof f.reason === 'number' && typeof f.cause === 'string');
  } catch { return []; }
}
