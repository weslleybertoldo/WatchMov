// Os plugins do APK no app do Windows (W2): no Electron o Capacitor é plataforma "web", então a ponte entra como a
// implementação web dos MESMOS plugins (registerPlugin(..., { web })), com os mesmos métodos e eventos. O resto do
// site (VideoPlayer, resolver.ts, streamSniffer.ts, nativePlayer.ts) não muda. Fora do app do Windows nada aqui roda:
// os guardas temCaptura() barram antes.
import { WebPlugin } from '@capacitor/core';
import { desktop } from './desktop';
import { fecharPlayerDesktop, playerDesktopAberto, tocarNoDesktop, type TocarDesktop } from './playerDesktop';

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

// Player básico (playerDesktop.ts). Sem próximo episódio, TV ou controle remoto ainda (W3/W5): responde como o APK
// responde quando não tem (o site cai no caminho de sempre).
export class PlayerNativoDesktop extends WebPlugin {
  async play(o: TocarDesktop): Promise<{ positionMs: number; url: string }> {
    return tocarNoDesktop(o, (evento, dados) => this.notifyListeners(evento, dados));
  }
  async loadNext(): Promise<{ ok: boolean }> { return { ok: false }; }
  async clearResume(): Promise<void> { /* o player básico não guarda posição própria */ }
  async castStatus(): Promise<{ active: boolean }> { return { active: false }; }
  async ackTvProgress(): Promise<void> { /* sem TV */ }
  async pendingExits(): Promise<{ exits: [] }> { return { exits: [] }; }
  async ackExits(): Promise<void> { /* sem fechamentos guardados */ }
  async closePlayer(): Promise<{ closed: boolean }> { return { closed: fecharPlayerDesktop() }; }
  async remoteKey(): Promise<{ handled: boolean }> { return { handled: false }; }
  async remoteState(): Promise<{ open: boolean }> { return { open: playerDesktopAberto() }; }
}
