import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

type BackHandler = () => boolean | Promise<boolean>;

/**
 * Registra um handler do botao voltar Android.
 * Retorne `true` no handler para indicar que o back foi consumido (nao sai do app).
 * Retorne `false` para cair na proxima camada (ou sair do app se ninguem consumir).
 *
 * Multiplos componentes podem registrar; o ultimo registrado tem prioridade (LIFO).
 */
const handlers: BackHandler[] = [];
let listenerAttached = false;

async function attachListener() {
  if (listenerAttached || !Capacitor.isNativePlatform()) return;
  listenerAttached = true;
  App.addListener("backButton", async () => {
    for (let i = handlers.length - 1; i >= 0; i--) {
      const consumed = await handlers[i]();
      if (consumed) return;
    }
    await App.exitApp();
  });
}

export function useAndroidBackButton(handler: BackHandler) {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    attachListener();
    handlers.push(handler);
    return () => {
      const idx = handlers.lastIndexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    };
  }, [handler]);
}
