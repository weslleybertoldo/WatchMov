import { Capacitor, registerPlugin } from '@capacitor/core';

// O MESMO APK roda no celular e na TV (Fire TV / Android TV). Quem sabe se é TV é o nativo
// (TvMode.java); a resposta chega antes do 1º render (main.tsx) e não muda mais — o aparelho
// é o mesmo a sessão inteira. Na TV não tem espelhar pra outra TV nem girar a tela.
interface TvModePlugin { get(): Promise<{ tv: boolean; brand?: string; model?: string }>; }
const TvMode = registerPlugin<TvModePlugin>('TvMode');

let tv = false;
let brand = '';
let model = '';

export function isTv(): boolean {
  return tv;
}

// Nome que aparece na lista "TVs conectadas" do celular.
export function tvDeviceInfo(): { name: string; model: string } {
  return { name: /amazon/i.test(brand) ? 'Fire TV' : 'TV Android', model };
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
