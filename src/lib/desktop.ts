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
  /** Rede de app (desktop/rede.ts, v5.21+; o .exe mais velho não tem): DNS próprio, CORS do vídeo e das listas do
   *  Ao Vivo, sem janelas de propaganda. `cabecalhos` guarda os que o servidor usou (Referer, Origin, token…) e o app
   *  repete nos pedidos da página ao mesmo host, igual ao ProxyServer do APK. */
  rede?: {
    cabecalhos(url: string, cabecalhos: Record<string, string>): Promise<boolean>;
    estado(): Promise<EstadoRedeDesktop>;
    /** v5.23+: cabeçalhos do link que o player do app toca (todo pedido de mídia da página leva); null = parou. */
    reproducao?(cabecalhos: Record<string, string> | null): Promise<boolean>;
    /** v5.23+: endereço pelo qual o player do app busca a playlist e os pedaços do HLS (processo principal, sem CORS). */
    videoPeloApp?(url: string): string;
  };
  /** Abrir sozinho (desktop/captura.ts, v5.23+; o .exe mais velho não tem): captura do link e resolvedor na janela
   *  escondida, com os mesmos eventos do APK (streamFound, streamQuality, resolverEvent). */
  captura?: CapturaDesktop;
}

export interface CapturaDesktop {
  sniffer(ligar: boolean): Promise<boolean>;
  resolverIniciar(o: Record<string, unknown>): Promise<boolean>;
  resolverParar(): Promise<boolean>;
  resolverOpcao(k: number): Promise<boolean>;
  aoEvento(cb: (evento: string, dados: unknown) => void): () => void;
}

export interface EstadoRedeDesktop {
  janelasBloqueadas: number;
  navegacoesBloqueadas: number;
  ultimaBloqueada: string;
  dns: string;
  hosts: number;
}

export const desktop: WmDesktop | undefined =
  typeof window === 'undefined' ? undefined : (window as unknown as { wmDesktop?: WmDesktop }).wmDesktop;

export const isDesktop = (): boolean => desktop !== undefined;

/** Tem lado nativo: o APK (Capacitor) ou o app do Windows. */
export const temNativo = (): boolean => Capacitor.isNativePlatform() || isDesktop();

/** Captura do link, resolvedor e player do app: o APK, ou o app do Windows que já tem a captura (v5.23+). O .exe mais
 *  velho segue tocando no servidor (iframe), como antes. */
export const temCaptura = (): boolean => Capacitor.isNativePlatform() || !!desktop?.captura;
