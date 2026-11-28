import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Componentes .tsx renderizados nos testes (react-dom/server) usam o JSX automático do Next
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Muitos testes importam a tela (ou a página) a frio dentro do próprio teste: a árvore de componentes cresceu e,
    // num shard carregado do CI, só esse import passa dos 5 s padrão (tela do técnico, cadastro por foto). O prazo
    // maior é para o import, não para a regra: um teste travado ainda cai, em 30 s.
    testTimeout: 30_000,
    // next-auth importa "next/server" sem extensão (ESM): processado pelo Vite, resolve normal.
    // Necessário para testar o Auth.js real (tests/unit/sessao-ativa.test.ts).
    server: { deps: { inline: ["next-auth"] } },
  },
});
