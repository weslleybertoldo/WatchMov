// App do WatchMov para Windows (Electron, pasta desktop/): a ponte que o desktop/preload.ts põe em window.wmDesktop.
// No site e no APK ela não existe. Cada parte do app do Windows acrescenta aqui o que precisa (plano 07/11/2026).
import { Capacitor } from '@capacitor/core';

export interface WmDesktop {
  /** Abre um endereço https no navegador do sistema (login do Google). */
  abrirFora(url: string): Promise<boolean>;
  /** Link de retorno do login que abriu o app quando ele estava fechado; devolve uma vez só. */
  linkPendente(): Promise<string | null>;
  /** Link de retorno que chega com o app aberto. Devolve a função que para de ouvir. */
  aoAbrirLink(cb: (url: string) => void): () => void;
}

export const desktop: WmDesktop | undefined =
  typeof window === 'undefined' ? undefined : (window as unknown as { wmDesktop?: WmDesktop }).wmDesktop;

export const isDesktop = (): boolean => desktop !== undefined;

/** Tem lado nativo: o APK (Capacitor) ou o app do Windows. */
export const temNativo = (): boolean => Capacitor.isNativePlatform() || isDesktop();
