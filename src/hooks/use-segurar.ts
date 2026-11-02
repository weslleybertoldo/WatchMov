import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

// Segurar o dedo (ou o botão do mouse) numa capa por SEGURAR_TOQUE_MS sem arrastar = `aoSegurar` (menu dos
// favoritos; pedido dele 01/11/2026). O toque que virou "segurar" não abre o título ao soltar, e arrastar (rolar a
// fileira) cancela. Na TV quem cuida é o tvNav (segurar o OK do controle).
export const SEGURAR_TOQUE_MS = 500;
const TOLERANCIA_PX = 10;

interface Segurar {
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onContextMenu: (e: ReactMouseEvent) => void;
  };
  engolirClique: () => boolean;
}

// W2 do raio-x (02/11/2026): o controle de cada capa nasce uma vez só (um objeto com as funções), em vez de 4 refs + 5
// callbacks + 1 efeito por capa — o Início monta ~120 capas e cada gancho custa na TV. Mesmo comportamento de antes.
function criarSegurar(aoSegurar: { current: () => void }): Segurar & { cancelar: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inicio: { x: number; y: number } | null = null;
  let segurou = false;

  const cancelar = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    inicio = null;
  };
  const disparar = () => {
    cancelar();
    segurou = true;
    aoSegurar.current();
  };

  return {
    cancelar,
    handlers: {
      onPointerDown: (e) => {
        segurou = false;
        if (e.button !== 0) return;   // botão direito: quem abre é o contextmenu
        inicio = { x: e.clientX, y: e.clientY };
        if (timer) clearTimeout(timer);
        timer = setTimeout(disparar, SEGURAR_TOQUE_MS);
      },
      onPointerMove: (e) => {
        if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > TOLERANCIA_PX) cancelar();
      },
      onPointerUp: cancelar,
      onPointerCancel: cancelar,
      onPointerLeave: cancelar,
      // Android: o toque longo também dispara o contextmenu (às vezes antes do nosso tempo) — vira o mesmo "segurar" e
      // não deixa abrir o menu do sistema nem selecionar o texto. No PC o botão direito faz o mesmo.
      onContextMenu: (e) => {
        e.preventDefault();
        if (!segurou) disparar();
      },
    },
    // O clique que chega depois de segurar não abre o título.
    engolirClique: () => {
      if (!segurou) return false;
      segurou = false;
      return true;
    },
  };
}

export function useSegurar(aoSegurar: () => void): Segurar {
  const cb = useRef(aoSegurar);
  cb.current = aoSegurar;
  const controle = useRef<ReturnType<typeof criarSegurar> | null>(null);
  if (!controle.current) controle.current = criarSegurar(cb);
  const c = controle.current;
  useEffect(() => c.cancelar, [c]);
  return c;
}
