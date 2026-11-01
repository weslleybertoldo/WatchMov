// Fila de tarefas pro tempo OCIOSO do navegador: uma por vez, na ordem de chegada (W4 das quedas na Fire TV, 01/11/2026).
// Cada tarefa roda num requestIdleCallback próprio, com prazo (com a TV ocupada ele não esperaria pra sempre); sem ele,
// num setTimeout curto. naFilaDoOcioso devolve o "desistir": tira a tarefa da fila se ela ainda não rodou.
const fila: Array<() => void> = [];
let agendado = false;
export const PRAZO_OCIOSO_MS = 1000;

function agendar() {
  if (agendado || fila.length === 0) return;
  agendado = true;
  const rodar = () => {
    agendado = false;
    const tarefa = fila.shift();
    try {
      tarefa?.();
    } finally {
      agendar();
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(rodar, { timeout: PRAZO_OCIOSO_MS });
  else setTimeout(rodar, 50);
}

export function naFilaDoOcioso(tarefa: () => void): () => void {
  fila.push(tarefa);
  agendar();
  return () => {
    const i = fila.indexOf(tarefa);
    if (i >= 0) fila.splice(i, 1);
  };
}
