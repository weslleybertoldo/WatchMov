// Ponte do player do app do Windows: o NativePlayer do APK (play/loadNext/closePlayer, desktopPlugins.ts) abre aqui o
// player completo (W3, src/components/desktop/PlayerDesktop.tsx) num React à parte, por cima do app, e devolve o mesmo
// resultado e os mesmos eventos do player do APK (progresso, qualidade, assistido, erro, próximo). Os cabeçalhos do
// link (Referer, Origin…) vão por desktop.rede.reproducao: o processo principal põe em todo pedido de vídeo da página,
// igual ao ProxyServer do APK. Fora do app do Windows nada aqui roda (os guardas temCaptura() barram antes).
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';
import { desktop } from './desktop';

export type Emitir = (evento: string, dados: Record<string, unknown>) => void;

/** O play(...) do app (= PlayOpts do nativePlayer.ts): o link, a lista do mesmo grupo e o que o player mostra. */
export interface OpcoesPlayer {
  url: string; mime?: string; title?: string; startMs?: number; headers?: Record<string, string>; referer?: string;
  ua?: string; urls?: string[]; mimes?: string[]; qualities?: string[]; hasNext?: boolean; key?: string;
  watched?: boolean; offline?: boolean; downloaded?: boolean; fonte?: string; servidores?: string[];
  servidorAtual?: string; imdbId?: string; episodios?: string;
}
/** @deprecated nome da W2; o mesmo que OpcoesPlayer. */
export type TocarDesktop = OpcoesPlayer;

/** O resultado ao fechar (= PlayResult do nativePlayer.ts). */
export interface ResultadoPlayer {
  positionMs: number; url: string; next?: boolean; server?: boolean; recapture?: boolean; watched?: boolean;
  watchedKey?: string; serverId?: string; episodio?: string; episodioVisto?: boolean;
}

/** O que a ponte pede ao player aberto (o componente preenche ao montar). */
export interface ControlePlayer {
  /** loadNext do app: troca o episódio NO player aberto (sem url = fecha pedindo o próximo, como o APK). */
  carregarProximo?: (o: Partial<OpcoesPlayer>) => boolean;
  /** closePlayer / ✕: fecha guardando a posição. */
  fechar?: () => void;
}

export interface PropsPlayerDesktop {
  opts: OpcoesPlayer;
  emitir: Emitir;
  /** Tem alguém ouvindo o evento? Sem ouvinte do playerNext o "Próximo" fecha na hora pedindo o próximo (= APK). */
  temOuvinte: (evento: string) => boolean;
  controle: ControlePlayer;
  aoFechar: (r: ResultadoPlayer) => void;
}

let aberto: { controle: ControlePlayer; terminar: (r: ResultadoPlayer) => void; opts: OpcoesPlayer } | null = null;

export const playerDesktopAberto = (): boolean => aberto !== null;

export function fecharPlayerDesktop(): boolean {
  const a = aberto;
  if (!a) return false;
  if (a.controle.fechar) a.controle.fechar();
  else a.terminar({ positionMs: a.opts.startMs ?? 0, url: a.opts.url });   // o player ainda nem montou
  return true;
}

/** loadNext do app: entrega o próximo episódio pro player aberto. false = não há player. */
export function proximoNoDesktop(o: Partial<OpcoesPlayer>): boolean {
  return aberto?.controle.carregarProximo?.(o) ?? false;
}

export const ehHls = (url: string, mime?: string): boolean =>
  (mime ?? '').toLowerCase().includes('mpegurl') || /\.m3u8(\?|#|$)|master\.txt(\?|#|$)/i.test(url);

/** Cabeçalhos que o player repete: os do link e, sem Referer/User-Agent neles, o referer e o ua do play. */
export function cabecalhosDaReproducao(o: Pick<OpcoesPlayer, 'headers' | 'referer' | 'ua'>): Record<string, string> {
  const h: Record<string, string> = { ...(o.headers ?? {}) };
  const tem = (nome: string) => Object.keys(h).some((k) => k.toLowerCase() === nome);
  if (o.referer && !tem('referer')) h.Referer = o.referer;
  if (o.ua && !tem('user-agent')) h['User-Agent'] = o.ua;
  return h;
}

type ClasseHls = typeof import('hls.js').default;

/** Loader do hls.js que busca a playlist e os pedaços pelo processo principal do app (esquema do vídeo, desktop/rede.ts),
 *  como o player nativo do APK. Motivo (Fonte 1, 07/11/2026): os pedaços vêm de outros servidores, disfarçados de
 *  .js/.css/.woff, e o CORS deles só libera o site do servidor. A resposta volta com o endereço de verdade, que o
 *  hls.js usa pra resolver os caminhos relativos da playlist. */
export function loaderPeloApp(Hls: ClasseHls, via: (url: string) => string): HlsConfig['loader'] {
  const Base = Hls.DefaultConfig.loader;
  return class LoaderPeloApp extends Base {
    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>): void {
      const original = context.url;
      context.url = via(original);
      const devolver = (c: LoaderContext) => { c.url = original; };
      super.load(context, config, {
        ...callbacks,
        onSuccess: (resposta, stats, c, detalhes) => {
          resposta.url = original;
          devolver(c);
          callbacks.onSuccess(resposta, stats, c, detalhes);
        },
        onError: (erro, c, detalhes, stats) => { devolver(c); callbacks.onError(erro, c, detalhes, stats); },
        onTimeout: (stats, c, detalhes) => { devolver(c); callbacks.onTimeout(stats, c, detalhes); },
      });
    }
  };
}

/** Abre o player e resolve quando ele fecha (✕, Esc, próximo sem link, servidor, episódio, link novo…). */
export function tocarNoDesktop(o: OpcoesPlayer, emitir: Emitir, temOuvinte: (evento: string) => boolean = () => true): Promise<ResultadoPlayer> {
  fecharPlayerDesktop();
  return new Promise((resolve) => {
    const caixa = document.createElement('div');
    caixa.setAttribute('data-wm-player-desktop', '');
    caixa.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
    document.body.appendChild(caixa);
    // A barra de rolagem da página aparecia por cima do vídeo (o player é fixo, a página continua rolável por baixo).
    const html = document.documentElement;
    const rolagemAntes = html.style.overflow;
    html.style.overflow = 'hidden';
    const raiz = createRoot(caixa);
    const controle: ControlePlayer = {};
    let fim = false;
    const terminar = (r: ResultadoPlayer) => {
      if (fim) return;
      fim = true;
      if (aberto?.controle === controle) aberto = null;
      html.style.overflow = rolagemAntes;
      void desktop?.rede?.reproducao?.(null);
      // Desmonta fora do evento que fechou (o clique/tecla ainda está no meio do React).
      window.setTimeout(() => { raiz.unmount(); caixa.remove(); }, 0);
      resolve(r);
    };
    aberto = { controle, terminar, opts: o };
    // O player (React + hls.js) só baixa quando abre: o site e o APK nunca carregam este pedaço.
    import('@/components/desktop/PlayerDesktop').then(({ PlayerDesktop }) => {
      if (fim) return;
      raiz.render(createElement(PlayerDesktop, { opts: o, emitir, temOuvinte, controle, aoFechar: terminar }));
    }).catch((e: unknown) => {
      // Sem o player (pedaço do site que sumiu num deploy novo, sem internet): volta pro servidor, como o .exe velho.
      emitir('playerError', { url: o.url, code: 0, name: 'DESKTOP_PLAYER_CARREGAR', cause: String(e).slice(0, 200), mime: o.mime, referer: o.referer, title: o.title });
      terminar({ positionMs: o.startMs ?? 0, url: o.url, server: true });
    });
  });
}
