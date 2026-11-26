import type { Config } from "tailwindcss";
import { acento, cena, escalaAcento, escalaOk, forma, neutro, status } from "./lib/ui/tokens";

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
        // "Inter"/"Archivo" (os subconjuntos além do latim, app/fonts/subconjuntos.css) vêm ANTES das
        // variáveis: cada face deles só atende o intervalo de caracteres dela, então o texto em
        // português passa direto para a face latina da variável — e um "Ω" ou "Ł" acha o arquivo
        // certo antes de cair na fonte de reserva do sistema.
        // "Inter Fallback"/"Archivo Fallback": a Arial ajustada que aparece enquanto a fonte carrega.
        sans: ["Inter", "var(--font-inter)", "Inter Fallback", "system-ui", "sans-serif"],
        // Títulos, números e KPIs
        display: ["Archivo", "var(--font-archivo)", "Archivo Fallback", "Inter", "var(--font-inter)", "Inter Fallback", "system-ui", "sans-serif"],
      },
      colors: {
        // Semânticos (preferidos)
        acento: acento,
        ok: status.ok,
        atencao: status.atencao,
        atrasado: status.atrasado,
        previsto: status.previsto,
        deslocamento: status.deslocamento,
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
          campo: neutro.bordaCampo,
          linha: neutro.linha,
        },
        frivo: { ...escalaAcento, 950: escalaAcento[900] },
        // Cena da calculadora pública (painel escuro premium) — só esta superfície de marketing usa
        cena: cena,
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
