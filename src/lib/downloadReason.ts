// Motivo da falha de download vem do nativo (DownloadFailure.java) como
// "motivo · parou em 37% · abra a aba Download pra retomar de onde parou".
// O tile da aba Download tem UMA linha de 9 px: mostra só o motivo (e o % se houver);
// a frase inteira vai no title do tile, no aviso da central e no botão do título.

/** Só a primeira parte ("Servidor da fonte parou de responder"). */
export function shortReason(reason?: string | null): string {
  const r = (reason ?? '').trim();
  if (!r) return 'erro';
  return r.split(' · ')[0].trim() || r;
}

/** 37 se o motivo trouxer "parou em 37%", senão null. */
export function reasonPercent(reason?: string | null): number | null {
  const m = /parou em (\d+)%/.exec(reason ?? '');
  return m ? Number(m[1]) : null;
}

/** Texto do tile: "Servidor da fonte parou de responder (37%)". */
export function tileReason(reason?: string | null): string {
  const p = reasonPercent(reason);
  return shortReason(reason) + (p != null ? ` (${p}%)` : '');
}
