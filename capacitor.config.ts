import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.weslley.watchmov',
  appName: 'WatchMov',
  webDir: 'dist',
  android: {
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
  server: {
    cleartext: false,
    androidScheme: 'https',
    // WebView serve os arquivos locais (dist), mas reporta este hostname como
    // origem. Sem isso a origem é "https://localhost" e os provedores de embed
    // BR (EmbedPlayApi etc) bloqueiam o referrer localhost ("não use localhost").
    hostname: 'watchmovbr.vercel.app',
  },
};

export default config;
