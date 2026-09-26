import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// O MESMO APK roda no celular e na TV (Fire TV / Android TV). Quem sabe se é TV é o nativo
// (TvMode.java); a resposta chega antes do 1º render (main.tsx) e não muda mais — o aparelho
// é o mesmo a sessão inteira. Na TV não tem espelhar pra outra TV nem girar a tela.
interface TvModePlugin {
  get(): Promise<{ tv: boolean; brand?: string; model?: string }>;
  cursorStart(o: { x: number; y: number; exitY: number; dpr: number }): Promise<void>;
  cursorStop(): Promise<void>;
  addListener(ev: 'cursorExit', cb: (d: { motivo: string }) => void): Promise<PluginListenerHandle>;
}
const TvMode = registerPlugin<TvModePlugin>('TvMode');

// Setinha do ▣ Servidor na TV (TvCursor.java). APK antigo não tem o método: false e nada muda.
export async function ligarSetinha(o: { x: number; y: number; exitY: number; dpr: number }): Promise<boolean> {
  try { await TvMode.cursorStart(o); return true; } catch { return false; }
}

export function desligarSetinha(): void {
  TvMode.cursorStop().catch(() => undefined);
}

// O nativo desligou a setinha sozinho (subiu acima do Ligar, app foi pro fundo).
export function aoSairDaSetinha(cb: (motivo: string) => void): () => void {
  let handle: PluginListenerHandle | undefined;
  let fora = false;
  try {
    TvMode.addListener('cursorExit', d => cb(d?.motivo ?? ''))
      .then(h => { if (fora) void h.remove(); else handle = h; })
      .catch(() => undefined);
  } catch { /* sem o nativo (navegador): não há setinha */ }
  return () => { fora = true; void handle?.remove(); };
}

let tv = false;
let brand = '';
let model = '';

export function isTv(): boolean {
  return tv;
}

export function isFireTv(): boolean {
  return tv && /amazon/i.test(brand);
}

// Nome que aparece na lista "TVs conectadas" do celular.
export function tvDeviceInfo(): { name: string; model: string } {
  return { name: isFireTv() ? 'Fire TV' : 'TV Android', model };
}

// Sem resposta do nativo no prazo (ou erro) = celular: a abertura do app nunca fica presa aqui.
export async function initDevice(timeoutMs = 1500): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      TvMode.get(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    tv = r?.tv === true;
    brand = r?.brand ?? '';
    model = r?.model ?? '';
  } catch {
    tv = false;
  } finally {
    clearTimeout(timer);
  }
}
