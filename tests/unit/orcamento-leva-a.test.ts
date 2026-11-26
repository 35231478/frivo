// @vitest-environment happy-dom
/**
 * Orçamento, leva A (anotações do dono nas telas Orçamento e Editar orçamento):
 *  - o número da OS vinculada no documento do cliente (tela, link público e PDF): regra pura
 *    `numerosOsDoDocumento` (mesma empresa, sem repetir, ordem de abertura) e a linha "OS" no cabeçalho;
 *  - "Obs.:" saiu do documento (a observação continua, só sem o rótulo redundante);
 *  - Normas atendidas no Editar: o nome da norma fica à vista e a descrição longa vai para o ⓘ ao lado
 *    (fora do <label>: o ⓘ não marca a caixa).
 * (O "Copiar link" tem o próprio arquivo: orcamento-copiar-link.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { NORMAS, numerosOsDoDocumento } from "@/lib/orcamentos/proposta";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/o1", useSearchParams: () => new URLSearchParams(),
}));

const os = (numero: string, criadoEm: string | null, empresaId: string | null = "e1") => ({ ordemServico: { numero, criadoEm, empresaId } });

describe("numerosOsDoDocumento — os números que o cliente vê", () => {
  it("na ordem em que as OS foram abertas (a mais antiga primeiro); empate pelo número", () => {
    expect(numerosOsDoDocumento([os("OS-760", "2026-11-20T10:00:00Z"), os("OS-753", "2026-11-02T10:00:00Z"), os("OS-755", "2026-11-10T10:00:00Z")], "e1"))
      .toEqual(["OS-753", "OS-755", "OS-760"]);
    expect(numerosOsDoDocumento([os("OS-10", "2026-11-02T10:00:00Z"), os("OS-9", "2026-11-02T10:00:00Z")], "e1")).toEqual(["OS-9", "OS-10"]);
    // sem data vai para o fim
    expect(numerosOsDoDocumento([os("OS-1", null), os("OS-2", "2026-11-02T10:00:00Z")], "e1")).toEqual(["OS-2", "OS-1"]);
  });
  it("multiempresa: OS de outra empresa nunca aparece (mesmo que o vínculo exista)", () => {
    expect(numerosOsDoDocumento([os("OS-753", "2026-11-02T10:00:00Z", "e1"), os("OS-999", "2026-11-01T10:00:00Z", "e2")], "e1")).toEqual(["OS-753"]);
  });
  it("sem repetir, sem vazio, sem OS nula; nada vinculado = lista vazia (a linha não aparece)", () => {
    expect(numerosOsDoDocumento([os("OS-753", "2026-11-02T10:00:00Z"), os(" OS-753 ", "2026-11-03T10:00:00Z"), os("  ", "2026-11-01T10:00:00Z"), { ordemServico: null }], "e1"))
      .toEqual(["OS-753"]);
    expect(numerosOsDoDocumento([], "e1")).toEqual([]);
    expect(numerosOsDoDocumento(null, "e1")).toEqual([]);
    expect(numerosOsDoDocumento(undefined)).toEqual([]);
  });
});

describe("documento do orçamento (tela, link público e PDF)", () => {
  const base = {
    codigo: "ORC-2026-0015", nome: "Manutenção", status: "ENVIADO", criadoEm: "2026-10-26T12:00:00Z", validadeEm: "2026-11-05T12:00:00Z",
    totalServicos: 80, totalProdutos: 0, totalGeral: 80, empresaId: "e1", produtos: [],
    servicos: [{ descricao: "Limpeza de Filtro", quantidade: 1, valorUnitario: 80, valorTotal: 80, observacao: "Aparelhos do 2º andar" }],
  };
  const montar = async (orcamento: Record<string, unknown>) => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, {
      orcamento: { ...base, ...orcamento }, empresa: { nome: "Clima Total Ltda", cnpj: "12345678000190" }, cliente: { nome: "Hospital Santa Clara", cpfCnpj: "22101333000111" }, versao: "cliente",
    }));
    return d;
  };
  const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

  it("OS vinculada: a linha 'OS' no cabeçalho, ao lado de Emissão e Válido até, só com o número (sem link)", async () => {
    const d = await montar({ ordensServico: [os("OS-760", "2026-11-20T10:00:00Z"), os("OS-753", "2026-11-02T10:00:00Z"), os("OS-999", "2026-11-01T10:00:00Z", "e2")] });
    const linha = d.querySelector("[data-os-documento]")!;
    expect([texto(linha.querySelector("dt")), texto(linha.querySelector("dd"))]).toEqual(["OS", "OS-753, OS-760"]);
    expect(linha.querySelector("a")).toBeNull(); // link para o cliente fica para depois (exige link público com token)
    // mesmo quadro das datas do documento
    expect(linha.parentElement!.querySelector("[data-validade-documento]")).toBeTruthy();
    expect(texto(d)).not.toContain("OS-999");
  });

  it("sem OS vinculada: a linha não aparece", async () => {
    expect((await montar({})).querySelector("[data-os-documento]")).toBeNull();
    expect((await montar({ ordensServico: [] })).querySelector("[data-os-documento]")).toBeNull();
  });

  it("a observação do item continua, sem o rótulo 'Obs.:'", async () => {
    const obs = (await montar({})).querySelector("[data-observacao-item]")!;
    expect(texto(obs)).toBe("Aparelhos do 2º andar");
    expect(obs.className).toContain("italic");
  });
});

describe("Normas atendidas (Editar orçamento): nome à vista, descrição no ⓘ", () => {
  let root: Root;
  let caixa: HTMLDivElement;
  afterEach(() => { act(() => root?.unmount()); caixa?.remove(); document.body.innerHTML = ""; });

  async function montar() {
    const { NormasCampo } = await import("@/components/orcamento/campos-corporativos");
    function Teste() {
      const [v, setV] = useState<string[]>([]);
      return createElement("div", null, createElement(NormasCampo, { valor: v, onChange: setV }), createElement("output", { "data-valor": v.join(",") }));
    }
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(Teste)); });
  }

  it("cada norma: caixa + nome numa linha; a descrição não fica à vista, vai para o ⓘ ao lado (fora do label)", async () => {
    await montar();
    const grupo = document.querySelector("[data-normas]")!;
    for (const n of NORMAS) {
      const caixaNorma = grupo.querySelector<HTMLInputElement>(`[data-norma='${n.codigo}']`)!;
      const label = caixaNorma.closest("label")!;
      expect(label.textContent!.trim()).toBe(n.titulo);
      const dica = label.parentElement!.querySelector(`button[aria-label='Ajuda: ${n.titulo}']`)!;
      expect(dica).toBeTruthy();
      expect(label.contains(dica)).toBe(false);
    }
    // a descrição longa saiu do quadro (vai para o balão do ⓘ, no portal)
    expect(grupo.textContent).not.toContain(NORMAS[0].descricao);
  });

  it("marcar continua funcionando; tocar no ⓘ não marca a caixa", async () => {
    await montar();
    const [a, b] = NORMAS;
    await act(async () => { document.querySelector<HTMLInputElement>(`[data-norma='${a.codigo}']`)!.click(); });
    expect(document.querySelector("[data-valor]")!.getAttribute("data-valor")).toBe(a.codigo);
    await act(async () => { document.querySelector<HTMLButtonElement>(`button[aria-label='Ajuda: ${b.titulo}']`)!.click(); });
    expect(document.querySelector("[data-valor]")!.getAttribute("data-valor")).toBe(a.codigo);
    expect(document.querySelector<HTMLInputElement>(`[data-norma='${b.codigo}']`)!.checked).toBe(false);
  });
});
