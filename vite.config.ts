import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import pkg from "./package.json";
import fs from "fs";
import type { Plugin } from "vite";

// App do Windows (W4): lista dos arquivos do build (os pedaços do app e o que vem de public/: fontes, logos) pro service
// worker dele (public/sw-desktop.js) guardar a interface e abrir sem internet. No navegador ninguém lê esta lista.
function listaDoBuild(): Plugin {
  let saida = "dist";
  return {
    name: "wm-arquivos",
    apply: "build",
    configResolved(c) { saida = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const arquivos: string[] = [];
      const andar = (pasta: string) => {
        for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
          const p = path.join(pasta, e.name);
          if (e.isDirectory()) andar(p);
          else arquivos.push(path.relative(saida, p).split(path.sep).join("/"));
        }
      };
      andar(saida);
      const fora = new Set(["index.html", "sw-desktop.js", "wm-arquivos.json", "robots.txt"]);
      fs.writeFileSync(path.join(saida, "wm-arquivos.json"), JSON.stringify(arquivos.filter((f) => !fora.has(f) && !f.endsWith(".map") && !f.startsWith(".")).sort()));
    },
  };
}

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
  plugins: [react(), listaDoBuild()],
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
