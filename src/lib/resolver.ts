import { registerPlugin, Capacitor } from '@capacitor/core';

export interface ResolvedStream { url?: string; referer?: string; mime?: string }

interface ResolverPlugin {
  // Abre o embed num WebView oculto (IP residencial do celular), aplica a técnica
  // (bloqueia disable-devtool + stealth + dispara play) e devolve a 1ª URL de vídeo.
  resolve(opts: { url: string; timeoutMs?: number }): Promise<ResolvedStream>;
}

const Resolver = registerPlugin<ResolverPlugin>('Resolver');

export const canResolve = () => Capacitor.isNativePlatform();

// Resolve UM embed → stream (ou null se não achou/timeout). Só no APK.
export async function resolveEmbed(embedUrl: string, timeoutMs = 18000): Promise<ResolvedStream | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const r = await Resolver.resolve({ url: embedUrl, timeoutMs });
    return r && r.url ? r : null;
  } catch {
    return null;
  }
}

// Resolve vários embeds em paralelo → lista dos que acharam (na ordem de entrada).
export async function resolveMany(
  items: { provider: string; label: string; embedUrl: string }[],
  timeoutMs = 18000,
): Promise<{ provider: string; label: string; url: string; referer?: string; mime?: string }[]> {
  if (!Capacitor.isNativePlatform()) return [];
  const settled = await Promise.all(
    items.map(async (it) => {
      const r = await resolveEmbed(it.embedUrl, timeoutMs);
      return r && r.url ? { provider: it.provider, label: it.label, url: r.url, referer: r.referer, mime: r.mime } : null;
    }),
  );
  return settled.filter(Boolean) as { provider: string; label: string; url: string; referer?: string; mime?: string }[];
}
