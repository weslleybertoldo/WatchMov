import { createClient } from "@supabase/supabase-js";
import { comecouEscrita, ehEscritaNoBanco, terminouEscrita } from "@/lib/escritasBanco";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Schema do ambiente: "public" (prod) ou "staging". Dirige PostgREST e realtime.
export const DB_SCHEMA = (import.meta.env.VITE_DB_SCHEMA as string) || "public";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY sao obrigatorios");
}

function createResilientFetch(retries = 2, timeout = 15000) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(input, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
          return response;
        }

        if (response.status >= 500 || response.status === 429) {
          if (attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
            continue;
          }
        }

        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < retries && (err as Error).name !== "AbortError") {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
    }

    throw lastError || new Error("Fetch failed after retries");
  };
}

type Busca = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// Conta as gravações em andamento (src/lib/escritasBanco.ts): o store só relê a biblioteca sem nenhuma no meio.
function contandoEscritas(f: Busca): Busca {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const metodo = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : undefined);
    if (!ehEscritaNoBanco(url, metodo)) return f(input, init);
    comecouEscrita();
    try {
      return await f(input, init);
    } finally {
      terminouEscrita();
    }
  };
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: contandoEscritas(createResilientFetch(2, 15000)),
    headers: { "x-schema": DB_SCHEMA },
  },
  db: { schema: DB_SCHEMA as "public" },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
