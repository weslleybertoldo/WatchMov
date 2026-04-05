import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App } from "@capacitor/app";
import { supabase } from "@/lib/supabase";

const isNative = Capacitor.isNativePlatform();
const REDIRECT_SCHEME = "com.weslley.watchmov";
const REDIRECT_URL = `${REDIRECT_SCHEME}://login-callback`;

export async function signInWithGoogle(): Promise<{ error?: string }> {
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
      const timeout = setTimeout(() => {
        resolve({ error: "Login cancelado ou expirado" });
      }, 120000);

      const listenerHandle = App.addListener("appUrlOpen", async (event) => {
        if (!event.url.startsWith(REDIRECT_SCHEME)) return;
        clearTimeout(timeout);

        try {
          const hashPart = event.url.includes("#") ? event.url.split("#")[1] : event.url.split("?")[1];
          if (!hashPart) {
            resolve({ error: "Resposta de login invalida" });
            return;
          }

          const params = new URLSearchParams(hashPart);
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");

          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            resolve(sessionError ? { error: sessionError.message } : {});
          } else {
            const errorDesc = params.get("error_description") || params.get("error");
            resolve({ error: errorDesc || "Tokens nao recebidos" });
          }
        } catch {
          resolve({ error: "Erro ao processar login" });
        }

        try { await Browser.close(); } catch {}
        listenerHandle.remove();
      });
    });

    await Browser.open({ url: data.url, windowName: "_self" });
    return await sessionPromise;
  } catch {
    return { error: "Erro ao abrir login do Google" };
  }
}

export function setupDeepLinkListener() {
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
        try { await Browser.close(); } catch {}
      }
    }
  });
}
