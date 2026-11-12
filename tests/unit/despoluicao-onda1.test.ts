// @vitest-environment happy-dom
/**
 * Despoluição — Onda 1 (Configurações e Cadastros padrão): o que a onda garante além do ratchet.
 *  - ícones de módulo são ícones do design system (lucide), não emoji; cada nome tem componente no editor;
 *  - o editor de perfis desenha um <svg> por módulo e nenhum emoji; o resumo de visibilidade é neutro;
 *  - rótulos de módulo/ação em caixa de frase;
 *  - cores de dado dos perfis e dos padrões de cadastro vêm da paleta única (lib/ui/tokens.ts).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SECOES, ACOES_LABEL, CORES_PERFIL, type IconeModulo } from "@/lib/permissoes";
import { corDado } from "@/lib/ui/tokens";
import { EditorPerfil } from "@/components/cadastros/editores/editor-perfil";
import { CADASTROS } from "@/lib/cadastros/registro";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const TITLE_CASE = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?: (?:de|da|do|das|dos|e|a|em|por))? [A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/;

describe("módulos de permissão", () => {
  const modulos = SECOES.flatMap((s) => s.modulos);
  it("ícone de módulo é nome de ícone lucide (PascalCase), nunca emoji", () => {
    expect(modulos.length).toBeGreaterThan(10);
    for (const m of modulos) {
      expect(m.icone, m.id).toMatch(/^[A-Z][A-Za-z0-9]+$/);
      expect(EMOJI.test(m.icone), m.id).toBe(false);
    }
  });
  it("rótulos de módulo e de ação em caixa de frase (sigla QR Codes passa)", () => {
    for (const m of modulos) if (m.label !== "QR Codes") expect(TITLE_CASE.test(m.label), m.label).toBe(false);
    for (const l of Object.values(ACOES_LABEL)) expect(TITLE_CASE.test(l), l).toBe(false);
    expect(modulos.find((m) => m.id === "ordens")!.label).toBe("Ordens de serviço");
    expect(ACOES_LABEL.contasReceber).toBe("Contas a receber");
  });
  it("cores de dado dos perfis e padrões de cor dos cadastros vêm da paleta única", () => {
    const paleta = new Set<string>(Object.values(corDado));
    for (const [tipo, cor] of Object.entries(CORES_PERFIL)) expect(paleta.has(cor), tipo).toBe(true);
    // Todo cadastro com campo "cor": o registro novo mínimo recebe uma cor da paleta
    let conferidos = 0;
    for (const def of Object.values(CADASTROS)) {
      if (!def.campos.some((c) => c.tipo === "cor")) continue;
      // schemas estritos: o registro mínimo varia por cadastro — a primeira forma que passa vale
      const candidatos = [{ nome: "Teste" }, { nome: "Teste", tipo: "PERSONALIZADO", permissoes: {} }, { nome: "Teste", etapas: [{ nome: "Etapa", prazoHoras: 1, responsavel: "RESPONSAVEL", canal: "SISTEMA" }] }];
      const r = candidatos.map((c) => def.schemaCriar.safeParse(c)).find((x) => x.success);
      if (!r) continue;
      const cor = (r.data as { cor?: string }).cor;
      if (cor) { expect(paleta.has(cor), def.entidade).toBe(true); conferidos++; }
    }
    expect(conferidos).toBeGreaterThanOrEqual(2);
  });
});

describe("editor de perfis", () => {
  let root: Root, caixa: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); caixa?.remove(); });
  it("um ícone svg por módulo, nenhum emoji; resumo de visibilidade neutro (sem acento, sem negrito)", async () => {
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(EditorPerfil, { item: null, aberto: true, onFechar: () => {}, onSalvo: () => {} })); });
    const modulos = SECOES.flatMap((s) => s.modulos);
    const texto = document.body.textContent ?? "";
    expect(EMOJI.test(texto)).toBe(false);
    for (const m of modulos) expect(texto).toContain(m.label);
    // cada linha de módulo começa com um svg (o ícone) antes do rótulo
    const linhas = [...document.body.querySelectorAll("div.flex.items-center.gap-2.min-w-\\[160px\\]")];
    expect(linhas.length).toBe(modulos.length);
    for (const l of linhas) expect(l.querySelector("svg"), l.textContent ?? "").not.toBeNull();
    const resumo = document.body.querySelector("[data-resumo-visibilidade]")!;
    expect(resumo.className).toContain("bg-surface-alt");
    expect(resumo.className).not.toMatch(/primary|acento/);
    expect(resumo.querySelector(".font-semibold, .font-bold")).toBeNull();
    expect(resumo.textContent).toContain("Módulos visíveis com este perfil");
  });
});
