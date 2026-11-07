import { useEffect, useState } from 'react';
import { PLAYER_NATIVO_EVENTO, playerNativoAberto } from '@/lib/nativePlayer';

// A página do app está na tela? Com o player nativo por cima (ou o app no fundo) o WebView fica "hidden": o que só
// serve pra tela de trás para até ela voltar (estudo do Nuvio, item 7, 20/10/2026 — a TV dele tem 1 GB).
// Na TV, com o player na frente, a página segue "visible" de propósito (PaginaViva.java: o controle remoto precisa do JS
// vivo) → o player nativo aberto também conta como página escondida.
export function paginaVisivel(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden' && !playerNativoAberto();
}

export function usePaginaVisivel(): boolean {
  const [visivel, setVisivel] = useState(paginaVisivel);
  useEffect(() => {
    const fn = () => setVisivel(paginaVisivel());
    document.addEventListener('visibilitychange', fn);
    window.addEventListener(PLAYER_NATIVO_EVENTO, fn);
    fn();   // mudou entre o 1º render e o efeito
    return () => {
      document.removeEventListener('visibilitychange', fn);
      window.removeEventListener(PLAYER_NATIVO_EVENTO, fn);
    };
  }, []);
  return visivel;
}
