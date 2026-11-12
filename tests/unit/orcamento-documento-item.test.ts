// @vitest-environment happy-dom
/**
 * Documento do orçamento — o item em hierarquia e o nome do arquivo:
 *  - o construtor grava "Nome — descrição cadastrada"; o documento separa de volta: nome em destaque,
 *    descrição numa linha abaixo (menor, cinza), observação por último (menor, cinza, itálico, "Obs.:");
 *  - só separa o que veio do catálogo (nome atual como prefixo; vinculado e renomeado: o 1º " — ");
 *    item digitado à mão fica inteiro, mesmo com " — " no meio (orçamento antigo não muda);
 *  - título da página = nome do PDF: "Orçamento 2026-0015 - CLIENTE", sem / \ : * ? " < > |.
 */
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));
import {
  descricaoDoCatalogo, limparNomeArquivo, partesItemDocumento, SEPARADOR_DESCRICAO_ITEM, tituloArquivoOrcamento,
} from "@/lib/orcamentos/proposta";

describe("partes do item (regra pura)", () => {
  it("o construtor junta nome e descrição cadastrada; sem descrição, só o nome", () => {
    expect(SEPARADOR_DESCRICAO_ITEM).toBe(" — ");
    expect(descricaoDoCatalogo("Limpeza de Filtro", "Higienização completa do filtro")).toBe("Limpeza de Filtro — Higienização completa do filtro");
    expect(descricaoDoCatalogo("Limpeza de Filtro", "  ")).toBe("Limpeza de Filtro");
    expect(descricaoDoCatalogo("Limpeza de Filtro", null)).toBe("Limpeza de Filtro");
  });

  it("vinculado ao catálogo: separa pelo nome atual (mesmo que o nome tenha ' — ')", () => {
    const d = descricaoDoCatalogo("Split — 9.000 BTUs", "Instalação padrão até 3 m");
    expect(partesItemDocumento(d, { vinculado: true, nome: "Split — 9.000 BTUs" })).toEqual({ nome: "Split — 9.000 BTUs", detalhe: "Instalação padrão até 3 m" });
    expect(partesItemDocumento("Limpeza — Higienização", { vinculado: true, nome: "Limpeza" })).toEqual({ nome: "Limpeza", detalhe: "Higienização" });
  });

  it("vinculado mas renomeado depois: separa no 1º ' — '; sem descrição: tudo é o nome", () => {
    expect(partesItemDocumento("Limpeza antiga — Higienização — completa", { vinculado: true, nome: "Limpeza nova" }))
      .toEqual({ nome: "Limpeza antiga", detalhe: "Higienização — completa" });
    expect(partesItemDocumento("Limpeza de Filtro", { vinculado: true, nome: "Limpeza de Filtro" })).toEqual({ nome: "Limpeza de Filtro", detalhe: null });
    expect(partesItemDocumento("Limpeza —  ", { vinculado: true })).toEqual({ nome: "Limpeza —", detalhe: null });
    expect(partesItemDocumento("Limpeza — ", { vinculado: true, nome: "Limpeza" })).toEqual({ nome: "Limpeza —", detalhe: null });
  });

  it("digitado à mão (sem vínculo): fica inteiro, mesmo com ' — '", () => {
    expect(partesItemDocumento("Instalação — 2 aparelhos")).toEqual({ nome: "Instalação — 2 aparelhos", detalhe: null });
    expect(partesItemDocumento("  Carga de gás  ", { vinculado: false, nome: "Carga de gás" })).toEqual({ nome: "Carga de gás", detalhe: null });
    expect(partesItemDocumento("— começa com traço", { vinculado: true })).toEqual({ nome: "— começa com traço", detalhe: null });
  });

  it("nome do catálogo só casa como prefixo inteiro seguido do separador", () => {
    expect(partesItemDocumento("Limpezas — X", { vinculado: true, nome: "Limpeza" })).toEqual({ nome: "Limpezas", detalhe: "X" });
    expect(partesItemDocumento("Limpeza — X", { vinculado: false, nome: "Limpeza" })).toEqual({ nome: "Limpeza", detalhe: "X" });
  });
});

describe("nome do arquivo (título da página)", () => {
  it("padrão 'Orçamento [número] - [cliente]'", () => {
    expect(tituloArquivoOrcamento("ORC-2026-0015", "CENTRO DE ATIVIDADES SESI RIO VERDE")).toBe("Orçamento 2026-0015 - CENTRO DE ATIVIDADES SESI RIO VERDE");
    expect(tituloArquivoOrcamento("ORC-2026-0015", "  ")).toBe("Orçamento 2026-0015");
    expect(tituloArquivoOrcamento("ORC-2026-0015", null)).toBe("Orçamento 2026-0015");
    expect(tituloArquivoOrcamento("PC-77")).toBe("Orçamento PC-77"); // código fora do padrão sai como está
  });

  it("tira o que não pode em nome de arquivo e espaços repetidos; ponto/espaço no fim saem", () => {
    expect(tituloArquivoOrcamento("ORC-2026-0003", 'Hospital S/A: "Matriz" | BH*?<>\\')).toBe("Orçamento 2026-0003 - Hospital S A Matriz BH");
    expect(limparNomeArquivo("A/B\\C:D*E?F\"G<H>I|J\tK\nL\u0000M\u007fN")).toBe("A B C D E F G H I J K L M N");
    expect(limparNomeArquivo("Comércio Ltda.")).toBe("Comércio Ltda");
    expect(limparNomeArquivo("x".repeat(200))).toHaveLength(150);
    expect(limparNomeArquivo("abc def ".repeat(30), 13)).toBe("abc def abc d");
    expect(limparNomeArquivo("Ação & Cia (MG) — nº 5")).toBe("Ação & Cia (MG) — nº 5"); // acentos e símbolos comuns ficam
  });
});

describe("documento: hierarquia do item (DOM)", () => {
  const servicos = [
    { descricao: "Limpeza de Filtro — Higienização completa do filtro e bandeja", servicoId: "s1", servico: { nome: "Limpeza de Filtro" }, quantidade: 1, valorUnitario: 80, valorTotal: 80, observacao: "Aparelhos do 2º andar" },
    { descricao: "Instalação — 2 aparelhos", quantidade: 1, valorUnitario: 300, valorTotal: 300 },
    { descricao: "Carga de gás", servicoId: "s3", servico: { nome: "Carga de gás" }, quantidade: 1, valorUnitario: 100, valorTotal: 100, observacao: "  " },
  ];
  const produtos = [
    { descricao: "Capacitor 35uF — Capacitor duplo para compressor", produtoId: "p1", produto: { nome: "Capacitor 35uF" }, quantidade: 2, valorUnitario: 30, valorTotal: 60, observacao: "Trocar os dois" },
    // Nome do catálogo com " — ": só o nome atual separa certo (o 1º " — " cortaria o nome)
    { descricao: "Tubo — 1/4 pol — Cobre flexível", produtoId: "p2", produto: { nome: "Tubo — 1/4 pol" }, quantidade: 1, valorUnitario: 0, valorTotal: 0 },
  ];
  const orcamento = {
    codigo: "ORC-2026-0015", nome: "Manutenção", status: "ENVIADO", criadoEm: "2026-10-26T12:00:00Z",
    totalServicos: 480, totalProdutos: 60, totalGeral: 540, servicos, produtos,
  };
  const empresa = { nome: "Clima Total Ltda", cnpj: "12345678000190" };
  const cliente = { nome: "CENTRO DE ATIVIDADES SESI RIO VERDE", cpfCnpj: "22101333000111" };
  const montar = async () => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, { orcamento, empresa, cliente, versao: "cliente" }));
    return d;
  };
  const partes = (td: Element) => [...td.querySelectorAll("[data-nome-item], [data-descricao-item], [data-observacao-item]")].map((e) => [
    e.hasAttribute("data-nome-item") ? "nome" : e.hasAttribute("data-descricao-item") ? "descricao" : "obs", e.textContent,
  ]);

  it("nome → descrição (menor, cinza) → observação (menor, cinza, itálico, 'Obs.:'), em Serviços e Produtos", async () => {
    const d = await montar();
    const celula = (g: string, i: number) => d.querySelectorAll(`[data-grupo-documento='${g}'] tr[data-linha-item]`)[i].querySelectorAll("td")[1];
    expect(partes(celula("serviços", 0))).toEqual([
      ["nome", "Limpeza de Filtro"], ["descricao", "Higienização completa do filtro e bandeja"], ["obs", "Obs.: Aparelhos do 2º andar"],
    ]);
    expect(partes(celula("produtos", 0))).toEqual([
      ["nome", "Capacitor 35uF"], ["descricao", "Capacitor duplo para compressor"], ["obs", "Obs.: Trocar os dois"],
    ]);
    expect(partes(celula("produtos", 1))).toEqual([["nome", "Tubo — 1/4 pol"], ["descricao", "Cobre flexível"]]);
    // Item à mão fica inteiro; observação em branco não aparece
    expect(partes(celula("serviços", 1))).toEqual([["nome", "Instalação — 2 aparelhos"]]);
    expect(partes(celula("serviços", 2))).toEqual([["nome", "Carga de gás"]]);

    const nome = celula("serviços", 0).querySelector("[data-nome-item]")!;
    const desc = celula("serviços", 0).querySelector("[data-descricao-item]")!;
    const obs = celula("serviços", 0).querySelector("[data-observacao-item]")!;
    expect(nome.className).toContain("text-ink"); // destaque: o tamanho/cor da tabela, como antes
    expect(nome.className).not.toContain("text-ink-muted");
    expect(desc.tagName).toBe("P"); // linha própria, abaixo do nome
    for (const el of [desc, obs]) {
      expect(el.className).toContain("text-[11px]");
      expect(el.className).toContain("print:text-[10px]");
      expect(el.className).toContain("text-ink-muted");
    }
    expect(desc.className).not.toContain("italic"); // descrição ≠ observação
    expect(obs.className).toContain("italic");
    expect(obs.querySelector("span")!.textContent).toBe("Obs.:");
    expect(obs.querySelector("span")!.className).toContain("not-italic");
  });

  it("o resto da linha não muda: qtd × unitário no celular continua abaixo, valores com ISS embutido", async () => {
    const d = await montar();
    const tr = d.querySelector("[data-grupo-documento='produtos'] tr[data-linha-item]")!;
    const td = tr.querySelectorAll("td")[1];
    expect([...td.children].map((e) => e.getAttribute("data-nome-item") !== null ? "nome" : e.getAttribute("data-descricao-item") !== null ? "descricao"
      : e.getAttribute("data-observacao-item") !== null ? "obs" : e.getAttribute("data-qtd-unitario-celular") !== null ? "qtd" : "?")).toEqual(["nome", "descricao", "obs", "qtd"]);
    expect(tr.querySelector("[data-total-item]")!.textContent).toBe("60,00");
  });

  it("proposta de contrato: os serviços inclusos com a mesma hierarquia", async () => {
    const { PropostaDocumento } = await import("@/components/orcamento/proposta-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(PropostaDocumento as any, {
      orcamento: { ...orcamento, tipo: "PROPOSTA_CONTRATO", equipamentosCobertos: [] }, empresa, cliente, responsavelTecnico: null, equipamentos: [],
    }));
    const td = [...d.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("Limpeza de Filtro"))!.querySelector("td")!;
    expect(partes(td)).toEqual([["nome", "Limpeza de Filtro"], ["descricao", "Higienização completa do filtro e bandeja"], ["obs", "Obs.: Aparelhos do 2º andar"]]);
  });
});

describe("construtor: escolher do catálogo grava 'Nome — descrição' (o que o documento separa)", () => {
  it("com descrição cadastrada junta com ' — '; sem descrição, só o nome", async () => {
    const { ItensTabela } = await import("@/components/orcamento/itens-tabela");
    const catalogo = [
      { id: "s1", codigo: "LIMP01", nome: "Limpeza de Filtro", descricao: "Higienização completa", valorPadrao: 80 },
      { id: "s2", codigo: "CARG01", nome: "Carga de gás", descricao: null, valorPadrao: 100 },
    ];
    const gravados: string[] = [];
    const caixa = document.createElement("div");
    document.body.appendChild(caixa);
    const root = createRoot(caixa);
    const montar = async () => act(async () => {
      root.render(createElement(ItensTabela as any, { titulo: "Serviços", labelAdicionar: "Buscar serviço", catalogo, itens: [], onChange: (its: { descricao: string }[]) => gravados.push(its.at(-1)!.descricao) }));
    });
    for (const q of ["limp01", "carga"]) {
      await montar();
      const campo = caixa.querySelector<HTMLInputElement>('input[placeholder="Buscar serviço"]')!;
      await act(async () => {
        campo.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, q);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const opcao = [...caixa.querySelectorAll("button")].find((b) => b.querySelector("p")?.textContent?.includes(q === "carga" ? "Carga" : "Limpeza"))!;
      await act(async () => { opcao.click(); });
    }
    expect(gravados).toEqual(["Limpeza de Filtro — Higienização completa", "Carga de gás"]);
    act(() => root.unmount()); caixa.remove();
  });
});
