import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

type BackHandler = () => boolean | Promise<boolean>;

/**
 * Registra um handler do botao voltar Android.
 * Retorne `true` para indicar que o back foi consumido (nao sai do app).
 * Retorne `false` para cair na proxima camada (ou sair do app se ninguem consumir).
 *
 * Multiplos componentes podem registrar; o ultimo a montar tem prioridade (LIFO
 * pela ordem de useEffect mount, NAO pela frequencia de re-render).
 */
type HandlerRef = { current: BackHandler };
const handlers: HandlerRef[] = [];
let listenerAttached = false;

function attachListener() {
  if (listenerAttached || !Capacitor.isNativePlatform()) return;
  listenerAttached = true;
  try {
    App.addListener("backButton", async () => {
      for (let i = handlers.length - 1; i >= 0; i--) {
        try {
          const consumed = await handlers[i].current();
          if (consumed) return;
        } catch (err) {
          // Handler com erro nao consome o back — segue chain.
          console.error("[useAndroidBackButton] handler error:", err);
        }
      }
      try { await App.exitApp(); } catch (err) {
        console.error("[useAndroidBackButton] exitApp:", err);
      }
    });
  } catch (err) {
    console.error("[useAndroidBackButton] attach:", err);
    listenerAttached = false;
  }
}

export function useAndroidBackButton(handler: BackHandler) {
  const ref = useRef<BackHandler>(handler);
  ref.current = handler; // sempre aponta para o handler mais recente

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    attachListener();
    handlers.push(ref);
    return () => {
      const idx = handlers.lastIndexOf(ref);
      if (idx !== -1) handlers.splice(idx, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
