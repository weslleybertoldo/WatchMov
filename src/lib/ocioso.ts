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

// W1 do raio-x (02/11/2026): o que não precisa estar pronto na abertura (avisos, push, registro da TV, verificação de
// atualização, log de erros) espera a tela assentar e ainda entra na fila do ocioso — antes rodava tudo junto com o 1º
// desenho, disputando a TV com a TMDB e as fileiras. Devolve o "desistir" (desmontou antes = não roda).
export const ESPERA_ASSENTAR_MS = 2500;

export function depoisDeAssentar(tarefa: () => void, esperaMs = ESPERA_ASSENTAR_MS): () => void {
  let desistir = () => {};
  let fora = false;
  const espera = setTimeout(() => { if (!fora) desistir = naFilaDoOcioso(tarefa); }, esperaMs);
  return () => { fora = true; clearTimeout(espera); desistir(); };
}
