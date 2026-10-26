import type { Config } from "tailwindcss";
import { acento, escalaAcento, escalaOk, forma, neutro, status } from "./lib/ui/tokens";

// Sistema de design: as cores e formas vêm de lib/ui/tokens.ts (fonte única). As escalas antigas
// (primary-*, success-*, ink, surface) foram mantidas como NOMES e remapeadas para a identidade
// nova; os nomes semânticos (acento, ok, atencao, atrasado, previsto) são os preferidos daqui em diante.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Classes montadas em lib/ (ex.: cores do avatar em CORES_AVATAR) — sem isto algumas não entravam no CSS
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        // Títulos, números e KPIs
        display: ["var(--font-archivo)", "Archivo", "var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        // Semânticos (preferidos)
        acento: acento,
        ok: status.ok,
        atencao: status.atencao,
        atrasado: status.atrasado,
        previsto: status.previsto,
        primary: escalaAcento,
        success: escalaOk,
        ink: {
          DEFAULT: neutro.texto,
          muted: neutro.secundario,
          subtle: neutro.suave,
        },
        surface: {
          DEFAULT: neutro.superficie,
          page: neutro.fundo,
          alt: neutro.fundo,
          border: neutro.borda,
          linha: neutro.linha,
        },
        frivo: { ...escalaAcento, 950: escalaAcento[900] },
      },
      boxShadow: {
        card: forma.sombraCard,
        "card-hover": forma.sombraCardHover,
        elevated: forma.sombraFlutuante,
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: forma.raioCard,
      },
    },
  },
  plugins: [],
};

export default config;
