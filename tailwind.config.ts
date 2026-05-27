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
      colors: {
        // Paleta Frivo — azul gelo / ciano industrial
        frivo: {
          50:  "#eff9ff",
          100: "#def2ff",
          200: "#b6e8ff",
          300: "#75d7ff",
          400: "#2cc3ff",
          500: "#00abf0",
          600: "#0088cc",
          700: "#006ca6",
          800: "#005a88",
          900: "#064b72",
          950: "#04304c",
        },
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
