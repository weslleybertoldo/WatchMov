import { registerPlugin, Capacitor } from '@capacitor/core';

export interface ExternalApp { id: string; pkg: string; name: string }

interface ExternalCastPlugin {
  listApps(): Promise<{ apps: ExternalApp[] }>;
  castToApp(opts: {
    pkg: string; url: string; mime?: string; title?: string;
    referer?: string; ua?: string; headers?: Record<string, string>; subs?: string[];
  }): Promise<void>;
}

const ExternalCast = registerPlugin<ExternalCastPlugin>('ExternalCast');

// Players externos instalados (WVC/VLC/MX/XCast). Vazio na web/sem nenhum.
export async function listExternalApps(): Promise<ExternalApp[]> {
  if (!Capacitor.isNativePlatform()) return [];
  try {
    const r = await ExternalCast.listApps();
    return r?.apps ?? [];
  } catch {
    return [];
  }
}

// Manda a URL do stream (+headers/legendas) pro app externo escolhido.
export async function castToExternal(opts: {
  pkg: string; url: string; mime?: string; title?: string;
  referer?: string; ua?: string; headers?: Record<string, string>; subs?: string[];
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    await ExternalCast.castToApp(opts);
    return true;
  } catch {
    return false;
  }
}
