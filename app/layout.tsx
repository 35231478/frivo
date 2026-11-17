import type { Metadata, Viewport } from "next";
import { archivo, inter } from "./fonts";
import "./fonts/subconjuntos.css";
import "./globals.css";

// Sistema de design: Inter no corpo e nos dados; Archivo em títulos e números. As fontes são
// arquivos do projeto (app/fonts) — o build não busca nada no Google.

export const metadata: Metadata = {
  applicationName: "Frivo",
  title: { default: "Frivo", template: "%s | Frivo" },
  description: "Sistema de Gestão para Climatização e Refrigeração",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Frivo",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${archivo.variable}`}>
      <body className="font-sans antialiased bg-surface-page text-ink">{children}</body>
    </html>
  );
}
