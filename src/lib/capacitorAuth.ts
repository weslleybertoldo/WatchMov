import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabase } from "@/lib/supabase";

const isNative = Capacitor.isNativePlatform();

export async function signInWithGoogle(): Promise<{ error?: string }> {
  if (!isNative) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) return { error: error.message };
    return {};
  }

  // Nativo: abre browser e retorna imediatamente
  // O appStateChange no AuthContext detecta a sessao quando voltar
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: "https://show-tracker-pro.vercel.app",
        skipBrowserRedirect: true,
      },
    });

    if (error || !data.url) {
      return { error: error?.message || "Erro ao iniciar login" };
    }

    await Browser.open({ url: data.url, windowName: "_self" });
    return {};
  } catch {
    return { error: "Erro ao abrir login do Google" };
  }
}
