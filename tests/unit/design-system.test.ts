// @vitest-environment happy-dom
/**
 * Sistema de design (fase 1): tokens únicos, contraste acessível, componentes-base e as regras
 * visuais da identidade (sem degradê, sem borda colorida à esquerda, sem emoji, sem cor solta) no
 * shell e nas telas-vitrine (central da OS e lista de OS).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { acento, contraste, escalaAcento, escalaOk, neutro, status } from "@/lib/ui/tokens";
import config from "../../tailwind.config";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

describe("tokens: definidos uma vez e com contraste acessível (4.5:1)", () => {
  it("texto legível sobre as superfícies", () => {
    for (const fundo of [neutro.fundo, neutro.superficie]) {
      expect(contraste(neutro.texto, fundo)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(neutro.secundario, fundo)).toBeGreaterThanOrEqual(4.5);
      expect(contraste(acento.DEFAULT, fundo)).toBeGreaterThanOrEqual(4.5); // links
    }
    expect(contraste(neutro.secundario, neutro.linha)).toBeGreaterThanOrEqual(4.5);
    // "suave" é só para ícone/placeholder/decoração: não passa como texto (e o token diz isso)
    expect(contraste(neutro.suave, neutro.superficie)).toBeLessThan(4.5);
  });

  it("botão primário, item ativo e pílulas de status", () => {
    expect(contraste("#FFFFFF", acento.DEFAULT)).toBeGreaterThanOrEqual(4.5);
    expect(contraste("#FFFFFF", acento.hover)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(acento.DEFAULT, acento.claro)).toBeGreaterThanOrEqual(4.5);
    for (const s of Object.values(status)) expect(contraste(s.texto, s.claro)).toBeGreaterThanOrEqual(4.5);
    expect(contraste("#FFFFFF", status.ok.DEFAULT)).toBeGreaterThanOrEqual(4.5);
    expect(contraste("#FFFFFF", status.atrasado.DEFAULT)).toBeGreaterThanOrEqual(4.5);
  });

  it("as cores aprovadas estão nos tokens (e o texto de OK/atenção só escurece o tom onde precisa)", () => {
    expect(neutro).toMatchObject({ fundo: "#F7F8FA", superficie: "#FFFFFF", borda: "#E4E7EC", linha: "#EEF1F5", texto: "#1A2230", secundario: "#5B6472", suave: "#8A94A6" });
    expect(acento).toEqual({ DEFAULT: "#0E7490", hover: "#0B5566", claro: "#E6F2F5" });
    expect(status.ok).toMatchObject({ DEFAULT: "#15803D", claro: "#E7F5EC" });
    expect(status.atencao).toMatchObject({ DEFAULT: "#B45309", claro: "#FBF0E0" });
    expect(status.atrasado).toMatchObject({ DEFAULT: "#B42318", claro: "#FBEAE8" });
    expect(status.previsto).toMatchObject({ DEFAULT: "#475569", claro: "#EEF1F5" });
    // o aprovado não passa como letra sobre o próprio claro: por isso existe "texto"
    expect(contraste(status.ok.DEFAULT, status.ok.claro)).toBeLessThan(4.5);
    expect(contraste(status.atencao.DEFAULT, status.atencao.claro)).toBeLessThan(4.5);
  });

  it("o Tailwind lê os tokens (fonte única): escalas antigas remapeadas para a identidade nova", () => {
    const c = (config.theme!.extend as any).colors;
    expect(c.primary[500]).toBe(acento.DEFAULT);
    expect(c.primary[600]).toBe(acento.hover);
    expect(c.primary[50]).toBe(acento.claro);
    expect(c.primary).toEqual(escalaAcento);
    expect(c.success).toEqual(escalaOk);
    expect(c.acento).toEqual(acento);
    expect(c.ink).toEqual({ DEFAULT: neutro.texto, muted: neutro.secundario, subtle: neutro.suave });
    expect(c.surface).toMatchObject({ page: neutro.fundo, border: neutro.borda, linha: neutro.linha });
    expect(c.ok).toEqual(status.ok);
    expect((config.theme!.extend as any).fontFamily.display[0]).toBe("var(--font-archivo)");
    expect((config.theme!.extend as any).borderRadius.card).toBe("14px");
  });

  it("globals.css: cores via theme() (nenhum hex solto nas camadas base/components) e status por função", () => {
    const css = ler("app/globals.css");
    const camadas = css.slice(0, css.indexOf("/* --- Animação da navegação por data"));
    expect(camadas.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(css).toMatch(/\.badge-status-concluida\s*\{\s*@apply pill-ok;/);
    expect(css).toMatch(/\.badge-status-cancelada\s*\{\s*@apply pill-atrasado;/);
    expect(css).toMatch(/\.badge-status-em_andamento\s*\{\s*@apply pill-atencao;/);
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: 2px solid theme\("colors\.acento\.DEFAULT"\)/);
    expect(ler("app/layout.tsx")).toMatch(/Archivo\(\{[\s\S]*weight: \["600", "700"\]/);
  });
});

/** Todos os .tsx de uma pasta (recursivo) ou o próprio arquivo. */
function tsx(rel: string): string[] {
  const abs = path.join(RAIZ, rel);
  if (rel.endsWith(".tsx")) return [rel];
  return readdirSync(abs, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? tsx(`${rel}/${d.name}`) : d.name.endsWith(".tsx") ? [`${rel}/${d.name}`] : []);
}

/**
 * Telas já varridas pelo sistema de design, por fase/lote. Cada lote novo entra aqui e passa a ser
 * protegido pelas regras da identidade.
 */
const VARRIDAS: Record<string, string[]> = {
  "fase 1 (shell + vitrines)": [
    "components/layout", "components/os/central", "components/os/os-detalhe.tsx", "components/ordens/ordens-lista-client.tsx",
    "components/acoes-massa", "components/listagem", "components/ui",
  ],
  "lote 1 (uso diário)": [
    "components/os", "app/(dashboard)/ordens", "components/tecnico", "app/tecnico", "components/calendario", "app/(dashboard)/calendario",
    "components/dashboard", "app/(dashboard)/dashboard", "app/(dashboard)/financeiro/page.tsx", "app/(dashboard)/prazos",
  ],
  "lote 2 (cadastros)": [
    "components/forms", "!components/forms/configuracoes-client.tsx", "components/clientes", "app/(dashboard)/clientes",
    "components/contratos", "app/(dashboard)/contratos", "components/equipamentos", "app/(dashboard)/equipamentos",
    "app/(dashboard)/colaboradores", "app/(dashboard)/tecnicos", "components/equipes", "app/(dashboard)/equipes",
    "components/veiculos", "app/(dashboard)/veiculos", "components/cadastros", "app/(dashboard)/orcamentos",
    // documento e aprovação pública do orçamento ficam para o lote 4 (fora do painel)
    "components/orcamento", "!components/orcamento/aprovacao-publica.tsx", "!components/orcamento/proposta-documento.tsx",
    "!components/orcamento/orcamento-documento.tsx",
  ],
  "lote 3 (financeiro, estoque e configurações)": [
    "components/financeiro", "app/(dashboard)/financeiro", "components/compras", "app/(dashboard)/compras",
    "components/estoque", "app/(dashboard)/estoque", "components/config", "app/(dashboard)/configuracoes",
    "components/forms/configuracoes-client.tsx", "components/perfil", "app/(dashboard)/perfil", "app/(dashboard)/leads-site",
    "app/(dashboard)/qrcodes", "components/importacao", "components/folha", "components/ia", "app/(dashboard)/sem-permissao",
    "app/(dashboard)/instalar", "app/(dashboard)/layout.tsx",
    // aprovação pública e documento da medição ficam para o lote 4 (fora do painel)
    "components/medicao", "!components/medicao/aprovacao-medicao.tsx", "!components/medicao/medicao-documento.tsx",
  ],
};

// Paleta solta do Tailwind (com variantes e opacidade): tudo deve vir dos tokens
const COR_SOLTA = /\b(?:bg|text|border|ring|divide|fill|stroke|outline|accent|placeholder|decoration|shadow)-(?:gray|slate|zinc|neutral|stone|red|amber|orange|yellow|green|emerald|blue|sky|cyan|indigo|violet|purple|fuchsia|pink|rose|teal|lime)-\d{2,3}\b/;
const DEGRADE = /bg-gradient|linearGradient|radialGradient|\b(?:from|via|to)-(?:[a-z]+-\d{2,3}|surface|ink|acento|ok|atencao|atrasado|previsto|primary|success|sidebar)\b/;
// Borda grossa à esquerda com cor (o "card com faixa colorida"), em qualquer forma
const BORDA_ESQUERDA = /border-l-(?:\[\d+px\]|[2-8])\b[^"`]*\bborder-l?-?(?:acento|ok|atencao|atrasado|primary|success|[a-z]+-\d{2,3})\b|\bborder-l-(?:acento|ok|atencao|atrasado|primary-\d+|success-\d+)\b|absolute left-0[^"]*w-1[^"]*rounded-r/;
const NAVY = /#14498F|#0F2744|bg-sidebar|from-sidebar/;
// Hex usado para PINTAR (style/fill/stroke ou fallback de cor): deve vir de lib/ui/tokens.ts.
// Hex como dado (ex.: valor padrão de um campo "cor" que o usuário escolhe) não conta. Classe arbitrária
// com hex (ex.: bg-[#F8FAFC]) também é pintura.
const HEX = /(?:backgroundColor|color|borderColor|fill|stroke|stopColor)\s*[:=]\s*\{?\s*["'`]#[0-9A-Fa-f]{3,6}|\?\?\s*["'`]#[0-9A-Fa-f]{3,6}|\b[a-z-]+-\[#[0-9A-Fa-f]{3,8}\]/;

describe("regras da identidade nas telas varridas", () => {
  // "!caminho" tira um arquivo da pasta do lote (ele é varrido em outro lote)
  const arquivos = (alvos: string[]) => {
    const fora = new Set(alvos.filter((a) => a.startsWith("!")).map((a) => a.slice(1)));
    return [...new Set(alvos.filter((a) => !a.startsWith("!")).flatMap(tsx))].filter((f) => !fora.has(f));
  };
  const casos = Object.entries(VARRIDAS).flatMap(([lote, alvos]) => arquivos(alvos).map((f) => [lote, f] as const));
  it("cada lote cobre arquivos de verdade", () => {
    for (const lote of Object.keys(VARRIDAS)) expect(casos.filter(([l]) => l === lote).length).toBeGreaterThan(3);
  });
  it.each(casos)("[%s] %s: sem degradê, faixa à esquerda, emoji, navy, hex ou cor fora do sistema", (_lote, rel) => {
    const src = ler(rel);
    expect(src).not.toMatch(DEGRADE);
    expect(src).not.toMatch(BORDA_ESQUERDA);
    expect(src).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(src).not.toMatch(COR_SOLTA);
    expect(src).not.toMatch(NAVY);
    expect(src).not.toMatch(HEX);
  });
});

// ── Componentes-base (DOM) ──
let root: Root; let caixa: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });
async function montar(el: any) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(el); });
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;

describe("componentes-base", () => {
  it("Button: primário = acento sólido, secundário = borda, fantasma; foco visível; <button> real", async () => {
    const { Button } = await import("@/components/ui/button");
    await montar(createElement("div", null,
      createElement(Button, { id: "p" }, "Salvar"),
      createElement(Button, { id: "s", variant: "secondary" }, "Cancelar"),
      createElement(Button, { id: "g", variant: "ghost" }, "Mais"),
      createElement(Button, { id: "d", variant: "danger" }, "Excluir")));
    const cls = (id: string) => $(`#${id}`)!.className;
    expect($("#p")!.tagName).toBe("BUTTON");
    expect(cls("p")).toMatch(/\bbg-acento\b.*text-white|text-white.*\bbg-acento\b/);
    expect(cls("p")).toContain("hover:bg-acento-hover");
    expect(cls("s")).toMatch(/border-surface-border/);
    expect(cls("s")).not.toMatch(/bg-acento\b/);
    expect(cls("g")).not.toMatch(/border-surface-border|bg-acento\b/);
    expect(cls("d")).toContain("bg-atrasado");
    for (const id of ["p", "s", "g", "d"]) expect(cls(id)).toContain("focus-visible:ring-acento");
  });

  it("StatusPill: a cor segue a função e o texto sempre aparece", async () => {
    const { StatusPill, TOM_ESTAGIO_OS, TOM_PRIORIDADE, TOM_PRAZO } = await import("@/components/ui/status-pill");
    await montar(createElement(StatusPill, { tom: TOM_ESTAGIO_OS.CONCLUIDA, "data-x": "1" } as any, "Concluída"));
    expect($("[data-x]")!.getAttribute("data-tom")).toBe("ok");
    expect($("[data-x]")!.className).toContain("bg-ok-claro");
    expect($("[data-x]")!.className).toContain("text-ok-texto");
    expect($("[data-x]")!.className).toContain("rounded-full");
    expect($("[data-x]")!.textContent).toBe("Concluída");
    expect([TOM_ESTAGIO_OS.EM_ANDAMENTO, TOM_ESTAGIO_OS.CANCELADA, TOM_ESTAGIO_OS.ABERTA, TOM_ESTAGIO_OS.AGENDADA, TOM_ESTAGIO_OS.FATURADA])
      .toEqual(["atencao", "atrasado", "previsto", "acento", "ok-solido"]);
    expect([TOM_PRIORIDADE.URGENTE, TOM_PRIORIDADE.ALTA, TOM_PRIORIDADE.BAIXA]).toEqual(["atrasado", "atencao", "previsto"]);
    expect([TOM_PRAZO.ATRASADO, TOM_PRAZO.VENCE_HOJE, TOM_PRAZO.CUMPRIDO, TOM_PRAZO.NO_PRAZO]).toEqual(["atrasado", "atencao", "ok", "previsto"]);
  });

  it("Stepper: feitos e atual no acento, futuros neutros; <ol> com aria-current=step", async () => {
    const { Stepper } = await import("@/components/ui/stepper");
    await montar(createElement(Stepper, { rotulo: "Andamento", atual: 1, passos: [{ id: "a", rotulo: "Aberta" }, { id: "b", rotulo: "Agendada" }, { id: "c", rotulo: "Concluída" }] }));
    const ol = $("ol")!;
    expect(ol.getAttribute("aria-label")).toBe("Andamento");
    const lis = [...ol.querySelectorAll("li")];
    expect(lis.map((l) => l.getAttribute("data-estado"))).toEqual(["feito", "atual", "futuro"]);
    expect(lis[1].getAttribute("aria-current")).toBe("step");
    expect(lis[0].querySelector("div")!.className).toContain("bg-acento");
    expect(lis[1].querySelector("div")!.className).toContain("bg-acento");
    expect(lis[2].querySelector("div")!.className).toContain("bg-surface-linha");
    expect(lis[0].textContent).toContain("(feito)"); // leitor de tela ouve o estado, não só a cor
  });

  it("Tabs: aba ativa sublinhada no acento, aria-current e <button> real", async () => {
    const { Tabs } = await import("@/components/ui/tabs");
    const onChange = vi.fn();
    await montar(createElement(Tabs, { tabs: [{ id: "a", label: "Resumo" }, { id: "b", label: "Atividades", badge: 2 }], active: "a", onChange, children: () => null }));
    const ativa = $("[data-aba='a']")!;
    expect(ativa.tagName).toBe("BUTTON");
    expect(ativa.getAttribute("aria-current")).toBe("page");
    expect(ativa.className).toContain("border-acento");
    expect($("[data-aba='b']")!.className).toContain("border-transparent");
    await act(async () => { ($("[data-aba='b']") as HTMLButtonElement).click(); });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("Kpi: número em Archivo; com ação vira <button> com foco visível", async () => {
    const { Kpi } = await import("@/components/ui/kpi");
    const onClick = vi.fn();
    await montar(createElement("dl", null, createElement(Kpi, { rotulo: "Atividades", onClick, "data-numero": "atividades" } as any, "1 de 2")));
    const b = $("[data-numero='atividades']")!;
    expect(b.tagName).toBe("BUTTON");
    expect(b.querySelector("dd")!.className).toContain("font-display");
    expect(b.className).toContain("rounded-card");
    expect(b.className).toContain("focus-visible:ring-acento");
    await act(async () => { (b as HTMLButtonElement).click(); });
    expect(onClick).toHaveBeenCalled();
  });

  it("Card: superfície branca, borda discreta, raio 14px, sombra levíssima", async () => {
    const { Card, CardTitulo } = await import("@/components/ui/card");
    await montar(createElement(Card, { as: "section", "data-c": "1" } as any, createElement(CardTitulo, null, "Datas")));
    const c = $("[data-c]")!;
    expect(c.tagName).toBe("SECTION");
    for (const k of ["bg-white", "rounded-card", "border-surface-border", "shadow-card", "p-5"]) expect(c.className).toContain(k);
    expect(c.querySelector("h3")!.textContent).toContain("Datas");
  });

  it("FormField: o label fica ligado ao campo (htmlFor = id)", async () => {
    const { FormField } = await import("@/components/ui/form-field");
    const { Input } = await import("@/components/ui/input");
    await montar(createElement(FormField, { label: "Número da OS", required: true } as any, createElement(Input, {})));
    const label = $("label")!; const input = $("input")!;
    expect(label.getAttribute("for")).toBe(input.id);
    expect(input.id).not.toBe("");
    expect(input.className).toContain("focus:border-acento");
  });
});
