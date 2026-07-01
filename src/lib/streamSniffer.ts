import { registerPlugin, Capacitor } from '@capacitor/core';

export interface SniffResult { url: string; mime?: string; referer?: string }

interface StreamSnifferPlugin {
  sniff(opts: { url: string; timeoutMs?: number }): Promise<SniffResult>;
  cancel(): Promise<void>;
}

const StreamSniffer = registerPlugin<StreamSnifferPlugin>('StreamSniffer');

// Captura a URL real do stream por trás do embed do servidor (só no APK Android;
// na web/local retorna null → o app usa o iframe do servidor como hoje).
export async function sniffStream(url: string, timeoutMs = 20000): Promise<SniffResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const r = await StreamSniffer.sniff({ url, timeoutMs });
    return r?.url ? r : null;
  } catch {
    return null;
  }
}

export function cancelSniff(): void {
  if (Capacitor.isNativePlatform()) StreamSniffer.cancel().catch(() => {});
}
