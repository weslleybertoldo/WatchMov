import { describe, it, expect, vi } from 'vitest';

let nativo = false;
let noPc = false;
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => nativo } }));
vi.mock('@/lib/desktop', () => ({ isDesktop: () => noPc }));

import { linkDoInstalador, mostrarBaixarWindows, PAGINA_DA_RELEASE } from './appWindows';

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

describe('Baixar o app para Windows', () => {
  it('só no navegador do Windows (fora do APK e do app do PC)', () => {
    nativo = false; noPc = false;
    expect(mostrarBaixarWindows(WIN)).toBe(true);
    expect(mostrarBaixarWindows(ANDROID)).toBe(false);
    expect(mostrarBaixarWindows(MAC)).toBe(false);
    noPc = true;
    expect(mostrarBaixarWindows(WIN)).toBe(false);
    noPc = false; nativo = true;
    expect(mostrarBaixarWindows(WIN)).toBe(false);
    nativo = false;
  });

  it('o .exe da release Latest; sem API ou sem .exe → a página da release', async () => {
    const resposta = (corpo: unknown, ok = true) => vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(corpo) } as Response));
    const assets = [
      { name: 'WatchMov-v5.29.apk', browser_download_url: 'https://github.com/x/WatchMov-v5.29.apk' },
      { name: 'WatchMov-Setup-5.29.0.exe.blockmap', browser_download_url: 'https://github.com/x/b' },
      { name: 'WatchMov-Setup-5.29.0.exe', browser_download_url: 'https://github.com/x/WatchMov-Setup-5.29.0.exe' },
    ];
    expect(await linkDoInstalador(resposta({ assets }))).toBe('https://github.com/x/WatchMov-Setup-5.29.0.exe');
    expect(await linkDoInstalador(resposta({ assets: assets.slice(0, 1) }))).toBe(PAGINA_DA_RELEASE);
    expect(await linkDoInstalador(resposta({}, false))).toBe(PAGINA_DA_RELEASE);
    expect(await linkDoInstalador(vi.fn(() => Promise.reject(new Error('rede'))))).toBe(PAGINA_DA_RELEASE);
  });
});
