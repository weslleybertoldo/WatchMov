import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import pkg from "./package.json";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Quando ESTE APK foi gerado: é o que decide se o release do GitHub é mais
    // recente (comparar só o número quebra quando a numeração é renumerada).
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  build: {
    rollupOptions: {
      output: {
        // W1 do raio-x (02/11/2026): sem o pedaço "radix" fixo — ele obrigava a abertura a baixar tooltip, select,
        // popover e menu (nenhum em uso) junto com o diálogo; agora cada um vai com a tela que usa. O roteador saiu do app.
        manualChunks: {
          react: ["react", "react-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
}));
