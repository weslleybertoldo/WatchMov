// Os plugins do APK no app do Windows (W2): no Electron o Capacitor é plataforma "web", então a ponte entra como a
// implementação web dos MESMOS plugins (registerPlugin(..., { web })), com os mesmos métodos e eventos. O resto do
// site (VideoPlayer, resolver.ts, streamSniffer.ts, nativePlayer.ts) não muda. Fora do app do Windows nada aqui roda:
// os guardas temCaptura() barram antes.
import { WebPlugin } from '@capacitor/core';
import { desktop } from './desktop';
import {
  fecharPlayerDesktop, playerDesktopAberto, proximoNoDesktop, tocarNoDesktop, type OpcoesPlayer, type ResultadoPlayer,
} from './playerDesktop';

const ouvintes: { sniffer?: SnifferDesktop; resolver?: ResolverDesktop } = {};
let ponteLigada = false;

// Um ouvinte só na ponte: streamFound/streamQuality vão pro StreamSniffer; resolverEvent pro Resolver.
function ligarPonte() {
  if (ponteLigada || !desktop?.captura) return;
  ponteLigada = true;
  desktop.captura.aoEvento((evento, dados) => {
    if (evento === 'resolverEvent') ouvintes.resolver?.emitir(evento, dados);
    else ouvintes.sniffer?.emitir(evento, dados);
  });
}

export class SnifferDesktop extends WebPlugin {
  constructor() { super(); ouvintes.sniffer = this; ligarPonte(); }
  emitir(evento: string, dados: unknown) { this.notifyListeners(evento, dados); }
  async startWatching(): Promise<void> { await desktop?.captura?.sniffer(true); }
  async stopWatching(): Promise<void> { await desktop?.captura?.sniffer(false); }
}

export class ResolverDesktop extends WebPlugin {
  constructor() { super(); ouvintes.resolver = this; ligarPonte(); }
  emitir(evento: string, dados: unknown) { this.notifyListeners(evento, dados); }
  async start(o: Record<string, unknown>): Promise<void> { await desktop?.captura?.resolverIniciar(o); }
  async stop(): Promise<void> { await desktop?.captura?.resolverParar(); }
  async pickOption(o: { k: number }): Promise<void> { await desktop?.captura?.resolverOpcao(o.k); }
}

// Player do app (playerDesktop.ts → PlayerDesktop.tsx, W3): mesmos métodos, resultado e eventos do NativePlayerPlugin
// do APK. Sem TV nem controle remoto (W5 / fora do PC): responde como o APK responde quando não tem.
export class PlayerNativoDesktop extends WebPlugin {
  async play(o: OpcoesPlayer): Promise<ResultadoPlayer> {
    return tocarNoDesktop(o, (evento, dados) => this.notifyListeners(evento, dados), (evento) => this.hasListeners(evento));
  }
  /** Resposta ao playerNext: troca o episódio no player aberto (= loadNextInPlace). ok=false só sem player. */
  async loadNext(o: Partial<OpcoesPlayer>): Promise<{ ok: boolean }> { return { ok: proximoNoDesktop(o ?? {}) }; }
  // O APK guarda a posição também no aparelho (SharedPreferences) e o clearResume apaga a do episódio que vai começar
  // do zero. O player do PC não guarda posição própria: ela mora só no streamCache do app (eventos de progresso e o
  // resultado ao fechar), então não há o que apagar — e nada pode reabrir o episódio seguinte no tempo do anterior.
  async clearResume(): Promise<void> { /* sem posição própria */ }
  async castStatus(): Promise<{ active: boolean }> { return { active: false }; }
  async ackTvProgress(): Promise<void> { /* sem TV */ }
  async pendingExits(): Promise<{ exits: [] }> { return { exits: [] }; }
  async ackExits(): Promise<void> { /* sem fechamentos guardados */ }
  async closePlayer(): Promise<{ closed: boolean }> { return { closed: fecharPlayerDesktop() }; }
  async remoteKey(): Promise<{ handled: boolean }> { return { handled: false }; }
  async remoteState(): Promise<{ open: boolean }> { return { open: playerDesktopAberto() }; }
}
