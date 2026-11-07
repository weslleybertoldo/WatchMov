import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { supabase } from "@/lib/supabase";
import { desktop, type WmDesktop } from "@/lib/desktop";

const isNative = Capacitor.isNativePlatform();
const REDIRECT_SCHEME = "com.weslley.watchmov";
const REDIRECT_URL = `${REDIRECT_SCHEME}://login-callback`;

// Retorno do Google pelo deep link (APK e app do Windows): os tokens vêm depois do # (ou do ?) e viram a sessão.
export async function concluirRetorno(url: string): Promise<{ error?: string }> {
  try {
    const hashPart = url.includes("#") ? url.split("#")[1] : url.split("?")[1];
    if (!hashPart) return { error: "Resposta de login invalida" };

    const params = new URLSearchParams(hashPart);
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      return sessionError ? { error: sessionError.message } : {};
    }
    const errorDesc = params.get("error_description") || params.get("error");
    return { error: errorDesc || "Tokens nao recebidos" };
  } catch {
    return { error: "Erro ao processar login" };
  }
}

// App do Windows (desktop/): o Google abre no navegador do PC (ele recusa login dentro de janela de app) e volta pro
// app pelo mesmo endereço do APK, que o Windows entrega ao app aberto (desktop/main.ts → wm:deep-link).
async function entrarPeloNavegadorDoPc(pc: WmDesktop): Promise<{ error?: string }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error || !data.url) return { error: error?.message || "Erro ao iniciar login" };
  const url = data.url;

  return new Promise((resolve) => {
    let fim = false;
    const terminar = (r: { error?: string }) => {
      if (fim) return;
      fim = true;
      clearTimeout(tempo);
      parar();
      resolve(r);
    };
    const tempo = setTimeout(() => terminar({ error: "Login cancelado ou expirado" }), 120000);
    const parar = pc.aoAbrirLink((link) => {
      if (link.startsWith(REDIRECT_SCHEME)) void concluirRetorno(link).then(terminar);
    });
    pc.abrirFora(url).then(
      (ok) => { if (!ok) terminar({ error: "Erro ao abrir o navegador" }); },
      () => terminar({ error: "Erro ao abrir o navegador" }),
    );
  });
}

export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (desktop) {
    try {
      return await entrarPeloNavegadorDoPc(desktop);
    } catch {
      return { error: "Erro ao abrir login do Google" };
    }
  }

  if (!isNative) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    return {};
  }

  // APK — fluxo com deep link
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: REDIRECT_URL,
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      return { error: error?.message || "Erro ao iniciar login" };
    }

    // Listener para capturar o deep link
    const sessionPromise = new Promise<{ error?: string }>((resolve) => {
      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        listenerHandle.remove();
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve({ error: "Login cancelado ou expirado" });
      }, 120000);

      const listenerHandle = App.addListener("appUrlOpen", async (event) => {
        if (!event.url.startsWith(REDIRECT_SCHEME)) return;
        clearTimeout(timeout);
        cleanup();

        resolve(await concluirRetorno(event.url));

        try { await Browser.close(); } catch { /* Browser ja fechado */ }
      });
    });

    await Browser.open({ url: data.url, windowName: "_self" });
    return await sessionPromise;
  } catch {
    return { error: "Erro ao abrir login do Google" };
  }
}

export function setupDeepLinkListener() {
  if (desktop) {
    // App do Windows aberto PELO link (estava fechado) ou link que chega com ele aberto, fora de um login em andamento.
    const tratar = (url: string | null) => {
      if (url?.startsWith(REDIRECT_SCHEME) && url.includes("access_token")) void concluirRetorno(url);
    };
    desktop.linkPendente().then(tratar, () => undefined);
    desktop.aoAbrirLink(tratar);
    return;
  }

  if (!isNative) return;

  App.addListener("appUrlOpen", async ({ url }) => {
    if (url.startsWith(REDIRECT_SCHEME) && url.includes("access_token")) {
      const hashPart = url.includes("#") ? url.split("#")[1] : url.split("?")[1];
      if (!hashPart) return;

      const params = new URLSearchParams(hashPart);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        try { await Browser.close(); } catch { /* Browser ja fechado */ }
      }
    }
  });
}
