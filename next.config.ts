import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  reloadOnOnline: true,
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  fallbacks: {
    document: "/offline",
  },
  workboxOptions: {
    runtimeCaching: [
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
        // APIs internas — rede primeiro com timeout curto
        urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/"),
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

const nextConfig: NextConfig = {
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
