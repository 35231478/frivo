import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Componentes .tsx renderizados nos testes (react-dom/server) usam o JSX automático do Next
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // next-auth importa "next/server" sem extensão (ESM): processado pelo Vite, resolve normal.
    // Necessário para testar o Auth.js real (tests/unit/sessao-ativa.test.ts).
    server: { deps: { inline: ["next-auth"] } },
  },
});
