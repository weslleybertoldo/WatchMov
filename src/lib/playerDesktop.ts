// Player básico do app do Windows (W2, plano 07/11/2026): toca o link capturado (mp4 ou HLS) num <video> em tela cheia
// por cima do app, com os controles do próprio navegador, e manda os mesmos eventos do player do APK (progresso,
// qualidade, erro). Os cabeçalhos do link (Referer, Origin…) vão por desktop.rede.reproducao: o processo principal põe
// em todo pedido de vídeo da página, igual ao ProxyServer do APK. A W3 troca por um player completo.
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js';
import { desktop } from './desktop';

type Emitir = (evento: string, dados: Record<string, unknown>) => void;
export interface TocarDesktop {
  url: string; mime?: string; title?: string; startMs?: number; headers?: Record<string, string>; referer?: string;
}

let fecharAtual: (() => void) | null = null;

export const playerDesktopAberto = (): boolean => fecharAtual !== null;

export function fecharPlayerDesktop(): boolean {
  const f = fecharAtual;
  if (!f) return false;
  f();
  return true;
}

export const ehHls = (url: string, mime?: string): boolean =>
  (mime ?? '').toLowerCase().includes('mpegurl') || /\.m3u8(\?|#|$)|master\.txt(\?|#|$)/i.test(url);

/** Cabeçalhos que o player repete: os do link e, sem Referer neles, o referer da captura. */
export function cabecalhosDaReproducao(o: Pick<TocarDesktop, 'headers' | 'referer'>): Record<string, string> {
  const h: Record<string, string> = { ...(o.headers ?? {}) };
  if (o.referer && !Object.keys(h).some((k) => k.toLowerCase() === 'referer')) h.Referer = o.referer;
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

/** Abre o player e resolve quando ele fecha (✕ ou Esc), com a posição em que parou. */
export function tocarNoDesktop(o: TocarDesktop, emitir: Emitir): Promise<{ positionMs: number; url: string }> {
  fecharPlayerDesktop();
  return new Promise((resolve) => {
    void desktop?.rede?.reproducao?.(cabecalhosDaReproducao(o));
    const caixa = document.createElement('div');
    caixa.setAttribute('data-wm-player-desktop', '');
    caixa.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000';
    const topo = document.createElement('div');
    topo.style.cssText = 'position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:12px;padding:12px 16px;'
      + 'background:linear-gradient(#000c,#0000);color:#fff;font:600 15px system-ui,sans-serif;z-index:1';
    const titulo = document.createElement('span');
    titulo.textContent = o.title ?? '';
    titulo.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.textContent = '✕';
    fechar.setAttribute('aria-label', 'Fechar o player');
    fechar.style.cssText = 'background:#ffffff26;color:#fff;border:0;border-radius:999px;width:36px;height:36px;font-size:18px;cursor:pointer';
    topo.append(titulo, fechar);
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width:100%;height:100%;background:#000';
    caixa.append(video, topo);
    document.body.appendChild(caixa);

    let hls: { destroy(): void } | null = null;
    let fim = false;
    const duracaoMs = () => (Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined);
    const progresso = () => emitir('playerProgress', { url: o.url, positionMs: Math.round(video.currentTime * 1000), durationMs: duracaoMs() });
    const relogio = window.setInterval(() => { if (!video.paused) progresso(); }, 5000);
    const erro = (code: number, name: string, cause: string, httpCode?: number) =>
      emitir('playerError', { url: o.url, code, httpCode, name, cause, mime: o.mime, referer: o.referer, title: o.title });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); encerrar(); }
    };
    const encerrar = () => {
      if (fim) return;
      fim = true;
      const positionMs = Math.round(video.currentTime * 1000);
      if (positionMs > 0) progresso();
      window.clearInterval(relogio);
      window.removeEventListener('keydown', tecla, true);
      try { hls?.destroy(); } catch { /* já destruído */ }
      video.removeAttribute('src');
      video.load();
      caixa.remove();
      void desktop?.rede?.reproducao?.(null);
      fecharAtual = null;
      resolve({ positionMs, url: o.url });
    };
    fecharAtual = encerrar;
    fechar.onclick = encerrar;
    window.addEventListener('keydown', tecla, true);
    video.addEventListener('loadedmetadata', () => {
      if (o.startMs && o.startMs > 0 && video.currentTime < 1) video.currentTime = o.startMs / 1000;
      if (video.videoHeight) emitir('playerQuality', { url: o.url, quality: `${video.videoHeight}p` });
    }, { once: true });
    video.addEventListener('error', () => {
      if (!hls) erro(video.error?.code ?? 0, 'DESKTOP_MEDIA_ERROR', video.error?.message ?? '');
    });

    // Sempre pelo hls.js quando é HLS: o Chromium novo diz que toca HLS sozinho (canPlayType) e falha com o master.txt
    // das fontes (erro 4, visto em 07/11/2026). O hls.js lê o conteúdo, não a extensão.
    if (ehHls(o.url, o.mime)) {
      void import('hls.js').then(({ default: Hls }) => {
        if (fim) return;
        if (!Hls.isSupported()) { video.src = o.url; return; }
        const via = desktop?.rede?.videoPeloApp;
        const h = new Hls({
          startPosition: o.startMs && o.startMs > 0 ? o.startMs / 1000 : -1,
          // Sem worker: a CSP do site (worker-src 'self') barra o worker que o hls.js cria por blob:.
          enableWorker: false,
          ...(via ? { loader: loaderPeloApp(Hls, (u) => via(u)) } : {}),
        });
        hls = h;
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) erro(0, `HLS_${String(d.type).toUpperCase()}`, String(d.details), d.response?.code);
        });
        h.loadSource(o.url);
        h.attachMedia(video);
      }).catch(() => { if (!fim) video.src = o.url; });
    } else {
      video.src = o.url;
    }
  });
}
