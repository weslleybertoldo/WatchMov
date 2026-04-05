import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle as capacitorSignIn } from "@/lib/capacitorAuth";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const signingOut = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    // Listener Capacitor — verificar sessao quando app volta ao foreground
    let capListener: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      capListener = CapApp.addListener("appStateChange", async ({ isActive }) => {
        try {
          if (isActive && !user) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              setSession(session);
              setUser(session.user);
            }
          }
        } catch (e) {
          console.warn("[Auth] Erro ao verificar sessao no foreground:", e);
        }
      });
    }

    // Sessao inicial
    if (!initializedRef.current) {
      initializedRef.current = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setSession(session);
          setUser(session.user);
        }
        setLoading(false);
      }).catch(() => setLoading(false));
    }

    // Listener de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (signingOut.current) return;

      if (event === "SIGNED_IN" && session?.user) {
        setSession(session);
        setUser(session.user);
      } else if (event === "TOKEN_REFRESHED" && session?.user) {
        setSession(session);
        setUser(session.user);
      } else if (event === "SIGNED_OUT") {
        setSession(null);
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
      if (capListener) capListener.remove();
    };
  }, []);

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const result = await capacitorSignIn();
    return { error: result.error ?? null };
  };

  const signOut = async () => {
    signingOut.current = true;
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("[Auth] Erro ao fazer signOut:", e);
    } finally {
      signingOut.current = false;
      setSession(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
