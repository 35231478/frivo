import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Sidebar — azul profundo
        sidebar: {
          DEFAULT: "#0F2744",
          900: "#0F2744",
          800: "#172F4F",
          700: "#1F3A60",
          hover: "#1B3556",
        },
        // Primária — azul vibrante
        primary: {
          50:  "#F0F9FF",
          100: "#E0F2FE",
          200: "#BAE6FD",
          300: "#7DD3FC",
          400: "#38BDF8",
          500: "#0EA5E9",
          600: "#0284C7",
          700: "#0369A1",
          800: "#075985",
          900: "#0C4A6E",
        },
        // Sucesso / destaque — verde esmeralda
        success: {
          50:  "#ECFDF5",
          100: "#D1FAE5",
          200: "#A7F3D0",
          300: "#6EE7B7",
          400: "#34D399",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        // Texto e neutros
        ink: {
          DEFAULT: "#1E293B",
          muted:   "#64748B",
          subtle:  "#94A3B8",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          page:    "#F1F5F9",
          alt:     "#F8FAFC",
          border:  "#E2E8F0",
        },
        // Paleta Frivo — REMAPEADA para o novo padrão visual.
        // Mantida para compatibilidade com componentes existentes.
        frivo: {
          50:  "#F0F9FF",
          100: "#E0F2FE",
          200: "#BAE6FD",
          300: "#7DD3FC",
          400: "#38BDF8",
          500: "#0EA5E9",
          600: "#0EA5E9",
          700: "#0284C7",
          800: "#172F4F",
          900: "#0F2744",
          950: "#0F2744",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
        "card-hover": "0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)",
        elevated: "0 10px 25px rgba(15, 39, 68, 0.15), 0 4px 10px rgba(15, 39, 68, 0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
