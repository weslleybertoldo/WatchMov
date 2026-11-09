// "Baixar o app para Windows" no Painel (W6, plano 07/11/2026): só no site aberto no navegador do Windows — no APK e
// no próprio app do PC não aparece. Baixa o .exe da release Latest (a mesma API do UpdateChecker do APK).
import { Capacitor } from '@capacitor/core';
import { isDesktop } from '@/lib/desktop';

export const RELEASE_LATEST_API = 'https://api.github.com/repos/weslleybertoldo/WatchMov/releases/latest';
export const PAGINA_DA_RELEASE = 'https://github.com/weslleybertoldo/WatchMov/releases/latest';

/** Navegador do Windows, fora do APK e fora do app do PC. */
export function mostrarBaixarWindows(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return !Capacitor.isNativePlatform() && !isDesktop() && /Windows NT/i.test(ua);
}

/** Endereço do instalador (.exe) da release Latest; sem resposta da API ou sem .exe → a página da release. */
export async function linkDoInstalador(buscar: typeof fetch = fetch): Promise<string> {
  try {
    const res = await buscar(RELEASE_LATEST_API, { cache: 'no-store' });
    if (!res.ok) return PAGINA_DA_RELEASE;
    const r = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] };
    return r.assets?.find((a) => /^WatchMov-Setup-.*\.exe$/i.test(a.name))?.browser_download_url ?? PAGINA_DA_RELEASE;
  } catch {
    return PAGINA_DA_RELEASE;
  }
}
