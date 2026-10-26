/**
 * Sistema de design do Frivo — os TOKENS, definidos uma vez só. O tailwind.config.ts lê daqui (e o
 * globals.css usa via theme()), e o teste de contraste confere os pares daqui. Para mudar a
 * identidade visual, muda-se este arquivo.
 *
 * Regras da identidade: base neutra, um acento (petróleo), status com função (OK, atenção,
 * atrasado, previsto), sem degradê, sem borda colorida à esquerda, sem emoji, com respiro.
 */

/** Base neutra */
export const neutro = {
  fundo: "#F7F8FA",      // fundo da página
  superficie: "#FFFFFF", // cards, barras, campos
  borda: "#E4E7EC",      // contorno de card/campo
  linha: "#EEF1F5",      // divisória entre linhas de lista/tabela
  texto: "#1A2230",      // texto principal
  secundario: "#5B6472", // texto de apoio (rótulos, metadados) — passa 4.5:1 sobre branco e fundo
  suave: "#8A94A6",      // ícones, placeholder e decoração — NÃO usar em texto que precisa ser lido
} as const;

/** Acento (petróleo): ação principal, item ativo, foco, links */
export const acento = {
  DEFAULT: "#0E7490",
  hover: "#0B5566",
  claro: "#E6F2F5",
} as const;

/**
 * Status com função: cor = significado. DEFAULT = a cor do status (ícone, barra, preenchimento
 * sólido com texto branco); claro = fundo da pílula; texto = a letra sobre o claro. Em OK e
 * atenção o texto é um tom um pouco mais escuro do mesmo matiz: #15803D e #B45309 sobre o
 * próprio claro dão 4.46:1, abaixo do mínimo de 4.5:1.
 */
export const status = {
  ok: { DEFAULT: "#15803D", claro: "#E7F5EC", texto: "#137A3A" },
  atencao: { DEFAULT: "#B45309", claro: "#FBF0E0", texto: "#A14A07" },
  atrasado: { DEFAULT: "#B42318", claro: "#FBEAE8", texto: "#B42318" },
  previsto: { DEFAULT: "#475569", claro: "#EEF1F5", texto: "#475569" },
} as const;

/**
 * Escalas usadas pelas classes que o sistema já tinha (primary-*, success-*): REMAPEADAS para a
 * identidade nova, para que o app inteiro herde o acento e o verde de "OK" sem trocar classe por
 * classe. 500 = cor base, 600 = hover, 50 = claro.
 */
export const escalaAcento = {
  50: acento.claro, 100: "#CCE6EC", 200: "#99CCD9", 300: "#5FAABF", 400: "#2B8BA6",
  500: acento.DEFAULT, 600: acento.hover, 700: "#0A4B5A", 800: "#083D4A", 900: "#062F39",
} as const;

export const escalaOk = {
  50: status.ok.claro, 100: "#CDEBD7", 200: "#9FD8B3", 300: "#6CC18C", 400: "#3BA466",
  500: status.ok.DEFAULT, 600: "#116A33", 700: "#0E5A2B",
} as const;

/** Forma */
export const forma = {
  raioCard: "14px",
  raioControle: "10px", // botões, campos, pílulas grandes
  sombraCard: "0 1px 2px rgba(16, 24, 40, 0.04)",
  sombraCardHover: "0 2px 8px rgba(16, 24, 40, 0.06)",
  sombraFlutuante: "0 12px 32px rgba(16, 24, 40, 0.12)", // menus, modais, gavetas
} as const;

/** Contraste WCAG (razão de luminância) entre duas cores #RRGGBB. */
export function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
