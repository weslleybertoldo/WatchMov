import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle as capacitorSignIn, setupDeepLinkListener } from "@/lib/capacitorAuth";
import { Capacitor } from "@capacitor/core";

const SESSION_KEY = "watchmov_cached_session";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getCachedSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function saveCachedSession(session: Session | null) {
  try {
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {}
}

// Setup deep link listener no boot
if (Capacitor.isNativePlatform()) {
  setupDeepLinkListener();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = getCachedSession();
  const [user, setUser] = useState<User | null>(cached?.user ?? null);
  const [session, setSession] = useState<Session | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      saveCachedSession(session);
      setLoading(false);
    });

    if (navigator.onLine) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        saveCachedSession(session);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<{ error: string | null }> => {
    const result = await capacitorSignIn();
    if (result.error) {
      return { error: result.error };
    }
    // Deep link flow: setSession ja foi chamado no capacitorAuth
    // Forcar refresh para garantir UI atualiza
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setSession(session);
      setUser(session.user);
      saveCachedSession(session);
    }
    return { error: null };
  };

  const signOut = async () => {
    saveCachedSession(null);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("[Auth] Erro ao fazer signOut:", e);
    }
    setSession(null);
    setUser(null);
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
