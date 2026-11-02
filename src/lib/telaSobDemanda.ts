import { createElement, lazy, useState, type ComponentType } from 'react';

// W1 do raio-x de fluidez (02/11/2026): tela que só aparece quando a pessoa abre (a página do título com o player, o
// Painel, Downloads, Bugs, avisos…) sai do JS da abertura e baixa na hora em que abre — ou antes, no ocioso, com
// `preparar()`. Já baixada, aparece direto, sem passar pelo Suspense (não pisca o "carregando").
// A escolha (direto × lazy) fica FIXA enquanto a tela estiver montada: trocar o tipo do elemento no meio remontaria a
// tela e perderia o estado dela (ex.: o player aberto).
export function telaSobDemanda<P extends object>(carregar: () => Promise<{ default: ComponentType<P> }>) {
  let pronta: ComponentType<P> | null = null;
  let promessa: Promise<{ default: ComponentType<P> }> | null = null;
  const preparar = () => {
    promessa ??= carregar().then(
      (m) => { pronta = m.default; return m; },
      (e) => { promessa = null; throw e; },   // falhou (ex.: site atualizado no meio): a próxima tentativa baixa de novo
    );
    return promessa;
  };
  const Preguicosa = lazy(preparar) as unknown as ComponentType<P>;
  function Tela(props: P) {
    const [Comp] = useState<ComponentType<P>>(() => pronta ?? Preguicosa);
    return createElement(Comp, props);
  }
  return Object.assign(Tela, { preparar });
}
