import { useEffect, useState } from 'react';

// A página do app está na tela? Com o player nativo por cima (ou o app no fundo) o WebView fica "hidden": o que só
// serve pra tela de trás para até ela voltar (estudo do Nuvio, item 7, 20/10/2026 — a TV dele tem 1 GB).
export function paginaVisivel(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function usePaginaVisivel(): boolean {
  const [visivel, setVisivel] = useState(paginaVisivel);
  useEffect(() => {
    const fn = () => setVisivel(paginaVisivel());
    document.addEventListener('visibilitychange', fn);
    fn();   // mudou entre o 1º render e o efeito
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  return visivel;
}
