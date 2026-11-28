import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  // Recarregar quando a conexão volta: só no sistema do escritório (components/pwa/recarregar-ao-voltar);
  // no app do técnico a volta do sinal só sincroniza (não interrompe uma foto ou observação)
  reloadOnOnline: false,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    runtimeCaching: [
      {
        // App do técnico: UMA página (Meu dia/Agenda/Perfil/OS são vistas dela, escolhidas pela query).
        // ignoreSearch: sem sinal, qualquer /tecnico?… abre a cópia guardada; os dados vêm do aparelho.
        urlPattern: ({ request, url }: { request: Request; url: URL }) => request.mode === "navigate" && url.pathname === "/tecnico",
        handler: "NetworkFirst",
        options: {
          cacheName: "frivo-tecnico",
          networkTimeoutSeconds: 4,
          matchOptions: { ignoreSearch: true },
          expiration: { maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Navegações (páginas) — tenta a rede primeiro, cai no cache se offline
        urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
        handler: "NetworkFirst",
        options: {
          cacheName: "frivo-paginas",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      {
        // APIs internas — rede primeiro com timeout curto. As do app do técnico ficam de fora: ele guarda
        // os próprios dados no aparelho (IndexedDB) e precisa saber quando a resposta é de verdade da rede
        urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/tecnico/"),
        handler: "NetworkFirst",
        options: {
          cacheName: "frivo-api",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      {
        // Imagens e ícones
        urlPattern: ({ request }: { request: Request }) => request.destination === "image",
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "frivo-imagens",
          expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
      {
        // Assets estáticos (JS/CSS/fontes)
        urlPattern: ({ request }: { request: Request }) =>
          ["style", "script", "worker", "font"].includes(request.destination),
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "frivo-assets",
          expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  },
});

// Memória do build (ver docs/build-memoria.md, com as medições):
// - na Vercel (VERCEL definido) o `next build` NÃO repete a checagem de tipos nem o lint. A etapa de tipos é a que mais
//   consome memória e, somada ao resto, estourava a máquina de 8 GB da Vercel (SIGKILL). Quem garante os tipos é o
//   job Typecheck do CI (`tsc --noEmit`, portão obrigatório do PR); no CI e local o next build continua checando;
// - webpackBuildWorker: compila num processo à parte, que termina antes da geração das páginas e devolve a memória.
//   O Next só liga sozinho quando não há `webpack` próprio, e o next-pwa tem o dele. O PWA sai igual (medido);
// - webpackMemoryOptimizations: um pouco menos de memória na compilação (medido: também um pouco mais rápido).
const naVercel = !!process.env.VERCEL;

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: naVercel },
  eslint: { ignoreDuringBuilds: naVercel },
  experimental: { webpackBuildWorker: true, webpackMemoryOptimizations: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "utfs.io",
      },
    ],
  },
};

export default withPWA(nextConfig);
