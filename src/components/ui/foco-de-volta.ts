import { useRef } from 'react';

// W4 do raio-x (02/11/2026): diálogo aberto por estado (sem o Trigger do Radix — menu de segurar a capa, "Deseja sair?",
// diálogos do Painel) devolve o foco, ao fechar, pra onde ele estava antes de abrir. Sem isto o Radix procura o Trigger,
// não acha e o foco cai no <body>: na TV o cartaz segurado perdia o foco e a próxima seta recomeçava longe dele.
export function useFocoDeVolta(onOpenAutoFocus?: (e: Event) => void, onCloseAutoFocus?: (e: Event) => void) {
  const antes = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      const a = document.activeElement;
      antes.current = a instanceof HTMLElement && a !== document.body ? a : null;
      onOpenAutoFocus?.(e);
    },
    onCloseAutoFocus: (e: Event) => {
      onCloseAutoFocus?.(e);
      const el = antes.current;
      antes.current = null;
      if (e.defaultPrevented || !el || !el.isConnected || !el.getClientRects().length) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
    },
  };
}
