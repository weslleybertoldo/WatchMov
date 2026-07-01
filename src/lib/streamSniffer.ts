import { registerPlugin, Capacitor } from '@capacitor/core';

// url presente = capturou; senão vem só o diagnóstico (seenCount/sample).
export interface SniffResult { url?: string; mime?: string; referer?: string; seenCount?: number; sample?: string[] }

interface StreamSnifferPlugin {
  sniff(opts: { url: string; timeoutMs?: number }): Promise<SniffResult>;
  cancel(): Promise<void>;
}

const StreamSniffer = registerPlugin<StreamSnifferPlugin>('StreamSniffer');

// Captura a URL real do stream por trás do embed (só no APK Android; na web/local
// retorna null → o app usa o iframe do servidor). Sem url, devolve o diagnóstico.
export async function sniffStream(url: string, timeoutMs = 20000): Promise<SniffResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await StreamSniffer.sniff({ url, timeoutMs });
  } catch {
    return null;
  }
}

export function cancelSniff(): void {
  if (Capacitor.isNativePlatform()) StreamSniffer.cancel().catch(() => {});
}
