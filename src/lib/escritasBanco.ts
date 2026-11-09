// Gravações no banco (PostgREST) em andamento — contadas no fetch do cliente do Supabase (src/lib/supabase.ts).
// Serve pra reler a biblioteca sem atropelar uma gravação (pedido dele 09/11/2026, minuto onde parou em todos os
// aparelhos): a leitura que começou com algo gravando, ou durante a qual algo começou a gravar, é descartada — senão a
// lista velha voltava pra tela e a próxima marcação regravava o `seasons` inteiro sem o ✓ que acabou de entrar.

let emVoo = 0;
let total = 0;

/** É gravação? Qualquer método que não seja leitura, nos endereços do PostgREST (`/rest/v1/`). */
export function ehEscritaNoBanco(url: string, method?: string): boolean {
  const m = (method || 'GET').toUpperCase();
  return m !== 'GET' && m !== 'HEAD' && url.includes('/rest/v1/');
}

export function comecouEscrita(): void { emVoo++; total++; }
export function terminouEscrita(): void { emVoo = Math.max(0, emVoo - 1); }

/** `emVoo` = gravando agora; `total` = quantas já começaram desde que o app abriu (pra ver se começou outra no meio). */
export function escritasDoBanco(): { emVoo: number; total: number } {
  return { emVoo, total };
}

/** Só pros testes. */
export function zerarEscritas(): void { emVoo = 0; total = 0; }
