import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

// Segurar o dedo (ou o botão do mouse) numa capa por SEGURAR_TOQUE_MS sem arrastar = `aoSegurar` (menu dos
// favoritos; pedido dele 01/11/2026). O toque que virou "segurar" não abre o título ao soltar, e arrastar (rolar a
// fileira) cancela. Na TV quem cuida é o tvNav (segurar o OK do controle).
export const SEGURAR_TOQUE_MS = 500;
const TOLERANCIA_PX = 10;

export function useSegurar(aoSegurar: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const segurou = useRef(false);
  const cb = useRef(aoSegurar);
  cb.current = aoSegurar;

  const cancelar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inicio.current = null;
  }, []);
  useEffect(() => cancelar, [cancelar]);

  const disparar = useCallback(() => {
    cancelar();
    segurou.current = true;
    cb.current();
  }, [cancelar]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    segurou.current = false;
    if (e.button !== 0) return;   // botão direito: quem abre é o contextmenu
    inicio.current = { x: e.clientX, y: e.clientY };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(disparar, SEGURAR_TOQUE_MS);
  }, [disparar]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const i = inicio.current;
    if (i && Math.hypot(e.clientX - i.x, e.clientY - i.y) > TOLERANCIA_PX) cancelar();
  }, [cancelar]);

  // Android: o toque longo também dispara o contextmenu (às vezes antes do nosso tempo) — vira o mesmo "segurar" e
  // não deixa abrir o menu do sistema nem selecionar o texto. No PC o botão direito faz o mesmo.
  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    if (!segurou.current) disparar();
  }, [disparar]);

  // O clique que chega depois de segurar não abre o título.
  const engolirClique = useCallback((): boolean => {
    if (!segurou.current) return false;
    segurou.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelar,
      onPointerCancel: cancelar,
      onPointerLeave: cancelar,
      onContextMenu,
    },
    engolirClique,
  };
}
