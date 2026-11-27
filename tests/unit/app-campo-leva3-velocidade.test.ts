/**
 * App de campo, leva 3 (PR C) — CONTRASTE DE SOL e ALVOS DE TOQUE (regra conferida no código):
 *  - a raiz do app do técnico liga o "campo-sol";
 *  - cada cor do campo-sol passa 7:1 (WCAG AAA) contra o fundo em que é usada;
 *  - os ícones pequenos compartilhados (dica, fechar do aviso e do modal) têm alvo invisível de pelo menos 44 px.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { escalaAcento, escalaOk, neutro, status } from "@/lib/ui/tokens";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (f: string) => readFileSync(path.join(RAIZ, f), "utf8");
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const BRANCO = "#FFFFFF";
const FUNDO_PAGINA = "#F5F7FA";

const css = ler("app/globals.css");
const regra = (seletor: string) => {
  const m = css.match(new RegExp(`\\.campo-sol \\.${seletor.replace(/[-]/g, "\\-")}[^{]*\\{\\s*(color|background-color):\\s*([^;]+);`));
  return m?.[2].trim() ?? null;
};
const cor = (valor: string | null): string => {
  if (!valor) throw new Error("regra ausente");
  if (valor.startsWith("#")) return valor;
  const tema: Record<string, string> = {
    'theme("colors.success.700")': escalaOk[700], 'theme("colors.primary.700")': escalaAcento[700],
  };
  if (!tema[valor]) throw new Error(`cor não reconhecida: ${valor}`);
  return tema[valor];
};

describe("campo-sol: contraste para ler no sol", () => {
  it("a raiz do app do técnico liga o campo-sol", () => {
    expect(ler("components/tecnico/app-tecnico.tsx")).toMatch(/className="min-h-screen bg-surface-page campo-sol"/);
  });

  it("texto de apoio: 7:1 no branco e no fundo da página (antes: 6:1 e 5,6:1)", () => {
    expect(contraste(neutro.secundario, BRANCO)).toBeLessThan(7); // o motivo da regra
    const c = cor(regra("text-ink-muted"));
    expect(contraste(c, BRANCO)).toBeGreaterThanOrEqual(7);
    expect(contraste(c, FUNDO_PAGINA)).toBeGreaterThanOrEqual(7);
  });

  it("alertas (atenção, atrasado, ok) sobre o fundo claro deles: 7:1", () => {
    expect(contraste(cor(regra("text-atencao-texto")), status.atencao.claro)).toBeGreaterThanOrEqual(7);
    expect(contraste(cor(regra("text-atrasado-texto")), status.atrasado.claro)).toBeGreaterThanOrEqual(7);
    expect(contraste(cor(regra("text-ok-texto")), status.ok.claro)).toBeGreaterThanOrEqual(7);
  });

  it("botões principais com texto branco (Cheguei, TUDO OK, Atenção): 7:1", () => {
    expect(contraste(BRANCO, cor(regra("bg-acento")))).toBeGreaterThanOrEqual(7);
    expect(contraste(BRANCO, cor(regra("bg-success-600")))).toBeGreaterThanOrEqual(7);
    expect(contraste(BRANCO, cor(regra("bg-atencao")))).toBeGreaterThanOrEqual(7);
  });

  it("links e itens ativos em acento: 7:1 no branco e no fundo claro do acento", () => {
    const c = cor(regra("text-acento"));
    expect(contraste(c, BRANCO)).toBeGreaterThanOrEqual(7);
    expect(contraste(c, "#E6F2F5")).toBeGreaterThanOrEqual(7);
  });
});

describe("alvos de toque ≥ 44 px nos ícones pequenos compartilhados", () => {
  const inset = (arquivo: string, ancora: string) => {
    const s = ler(arquivo);
    const i = s.indexOf(ancora);
    expect(i, ancora).toBeGreaterThan(-1);
    const m = s.slice(i, i + 600).match(/before:-inset-(?:\[(\d+)px\]|(\d+))/);
    expect(m, `${arquivo}: hitbox`).toBeTruthy();
    return m![1] ? Number(m![1]) : Number(m![2]) * 4;
  };
  it("dica (ícone de 18 px): 18 + 2×13 = 44", () => {
    expect(18 + 2 * inset("components/ui/dica.tsx", "Alvo de toque")).toBeGreaterThanOrEqual(44);
  });
  it("fechar do aviso (16 px): 16 + 2×14 = 44", () => {
    expect(16 + 2 * inset("components/ui/avisos.tsx", 'aria-label="Fechar"')).toBeGreaterThanOrEqual(44);
  });
  it("fechar do modal (28 px): 28 + 2×8 = 44", () => {
    expect(28 + 2 * inset("components/ui/modal.tsx", 'aria-label="Fechar"')).toBeGreaterThanOrEqual(44);
  });
});
