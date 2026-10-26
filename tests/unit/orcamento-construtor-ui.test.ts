// @vitest-environment happy-dom
/**
 * Construtor de orçamento (o do comercial, também usado na gaveta da OS), num DOM de verdade:
 *  - dentro da OS só existe "Orçamento"; no Comercial, os dois tipos;
 *  - validade já vem com hoje + 10 dias;
 *  - unitário ↔ total por item (total digitado recalcula o unitário, ao centavo);
 *  - observação do item em campo que expande;
 *  - desconto por grupo (R$/%), ISS destacado e total geral; o payload leva tudo;
 *  - "Gerar descrição (IA)": sem chave fica desabilitado; com descrição vazia preenche; com texto
 *    já escrito só SUGERE, e substituir pede confirmação.
 * E o documento: versão do cliente com ISS embutido × versão interna com a linha do ISS.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: nav.back }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const BASE = {
  clientes: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }],
  catalogoServicos: [{ id: "s1", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 500 }],
  catalogoProdutos: [{ id: "p1", nome: "Capacitor 35uF", descricao: null, unidade: "UN", valorPadrao: 50 }],
  tecnicos: [], termoTemplates: [], clienteIdInicial: "c1",
};

beforeAll(async () => {
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  respostas = { "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null }, "POST /api/orcamentos": { status: 201, corpo: { id: "o1" } } };
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function montar(props: Record<string, unknown> = {}) {
  const [{ OrcamentoForm }, { PermissoesProvider }] = await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OrcamentoForm as any, { mode: "novo", ...BASE, ...props }) }));
  });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (texto: string) => $$<HTMLButtonElement>("button").find((b) => b.textContent?.trim() === texto);
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function adicionar(busca: string, nome: string) {
  await digitar($(`input[placeholder='${busca}']`), nome.slice(0, 5));
  await clicar($$("button").find((b) => b.textContent?.includes(nome)));
}
const linhas = () => $$("[data-item-linha]");
const campo = (linha: Element, c: string) => linha.querySelector<HTMLInputElement>(`[data-campo='${c}']`)!;
const valor = (dado: string) => $(`[data-valor='${dado}']`)?.textContent?.replace(/\s/g, " ");
async function salvar() {
  await digitar($("input[data-nome-orcamento]"), "Corretiva UTI");
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await esperar();
  return chamadas.find((c) => c.metodo === "POST" && c.url === "/api/orcamentos")?.corpo;
}

describe("tipo de documento e validade", () => {
  it("dentro da OS: só 'Orçamento' (o card de tipo some); no Comercial: os dois tipos", async () => {
    await montar({ embutido: { osId: "os1", onSalvo: () => {}, onCancelar: () => {} }, osInicialId: "os1" });
    expect(document.body.textContent).not.toContain("Proposta de Contrato");
    expect(document.body.textContent).not.toContain("Tipo de documento");
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const corpo = await salvar();
    expect(corpo.tipo).toBe("COMUM");
    act(() => root.unmount()); caixa.remove();
    await montar();
    expect(document.body.textContent).toContain("Tipo de documento");
    expect(document.body.textContent).toContain("Proposta de Contrato");
  });

  it("validade padrão = hoje (Brasília) + 10 dias, editável", async () => {
    await montar();
    const hoje = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const alvo = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 10));
    const esperado = `${String(alvo.getUTCDate()).padStart(2, "0")}/${String(alvo.getUTCMonth() + 1).padStart(2, "0")}/${alvo.getUTCFullYear()}`;
    expect($<HTMLInputElement>("input[aria-label='Validade']")!.value).toBe(esperado);
    expect(document.body.textContent).toContain("Padrão: 10 dias após a data do orçamento");
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const corpo = await salvar();
    expect(corpo.validadeEm).toBe(alvo.toISOString().slice(0, 10));
  });

  it("na edição a validade gravada é mantida (não troca pelo padrão)", async () => {
    await montar({ mode: "editar", inicial: { id: "o1", nome: "X", clienteId: "c1", validadeEm: "2026-12-31", descontoServicos: 0, tipoDescontoServicos: "VALOR", descontoProdutos: 0, tipoDescontoProdutos: "VALOR", issAliquota: 0, servicos: [], produtos: [], ordensServicoIds: [] } });
    expect($<HTMLInputElement>("input[aria-label='Validade']")!.value).toBe("31/12/2026");
  });
});

describe("itens: unitário ↔ total e observação", () => {
  it("digitar o TOTAL recalcula o unitário (100 ÷ 3 = 33,33) e o total digitado manda no subtotal", async () => {
    await montar();
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const l = linhas()[0];
    expect(campo(l, "unitario").value).toBe("500,00");
    expect(campo(l, "total").value).toBe("500,00");
    await digitar(campo(l, "quantidade"), "3");
    expect(campo(linhas()[0], "total").value).toBe("1500,00");
    await digitar(campo(linhas()[0], "total"), "100");
    expect(campo(linhas()[0], "unitario").value).toBe("33,33");
    expect($("[data-subtotal-grupo]")?.textContent).toContain("100,00");
    // Editar o unitário recalcula o total (unitário × qtd)
    await digitar(campo(linhas()[0], "unitario"), "50,5");
    expect(campo(linhas()[0], "total").value).toBe("151,50");
    await digitar(campo(linhas()[0], "total"), "1.000,00"); // aceita milhar com ponto
    expect(campo(linhas()[0], "unitario").value).toBe("333,33");
    const corpo = await salvar();
    expect(corpo.servicos[0]).toMatchObject({ quantidade: 3, valorUnitario: 333.33, valorTotal: 1000 });
  });

  it("observação: botão abre um campo que expande; o texto vai no payload", async () => {
    await montar();
    await adicionar("Buscar produto por nome...", "Capacitor 35uF");
    expect($("[data-observacao-item]")).toBeNull();
    await clicar($("[data-abrir-observacao]"));
    const area = $<HTMLTextAreaElement>("[data-observacao-item] textarea")!;
    expect(area.getAttribute("aria-label")).toBe("Observação de Capacitor 35uF");
    await digitar(area, "Peça original, garantia de 90 dias");
    const corpo = await salvar();
    expect(corpo.produtos[0].observacao).toBe("Peça original, garantia de 90 dias");
  });
});

describe("descontos por grupo, ISS e totais", () => {
  it("desconto % nos serviços, R$ nos produtos, ISS 5% sobre os serviços líquidos; payload com tudo", async () => {
    await montar({ issAliquota: 5 });
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    await digitar(campo(linhas()[0], "quantidade"), "2"); // 1000
    await adicionar("Buscar produto por nome...", "Capacitor 35uF");
    await digitar(campo(linhas()[1], "quantidade"), "4"); // 200
    const [dServ, dProd] = $$("[data-desconto-grupo]");
    await digitar(dServ.querySelector("input"), "10");
    await clicar([...dServ.querySelectorAll("button")].find((b) => b.textContent === "%"));
    await digitar(dProd.querySelector("input"), "20");
    expect(valor("subtotal-servicos")).toBe("R$ 1.000,00");
    expect(valor("desconto-servicos")).toBe("− R$ 100,00");
    expect($("[data-linha-iss]")?.textContent).toContain("ISS (5%)");
    expect(valor("iss")).toBe("+ R$ 45,00");
    expect(valor("total-servicos")).toBe("R$ 945,00");
    expect(valor("desconto-produtos")).toBe("− R$ 20,00");
    expect(valor("total-produtos")).toBe("R$ 180,00");
    expect(valor("total-geral")).toBe("R$ 1.125,00");
    const corpo = await salvar();
    expect(corpo).toMatchObject({ descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL", descontoProdutos: 20, tipoDescontoProdutos: "VALOR", atualizarIss: false });
    expect(corpo.desconto).toBeUndefined();
  });

  it("sem ISS configurado: aviso discreto, sem linha de ISS", async () => {
    await montar({ issAliquota: 0 });
    expect($("[data-linha-iss]")).toBeNull();
    expect($("[data-sem-iss]")?.textContent).toContain("Sem ISS");
  });

  it("edição com alíquota diferente da empresa: oferece usar a atual e manda atualizarIss", async () => {
    await montar({
      mode: "editar", issAliquota: 3,
      inicial: { id: "o1", nome: "X", clienteId: "c1", descontoServicos: 0, tipoDescontoServicos: "VALOR", descontoProdutos: 0, tipoDescontoProdutos: "VALOR", issAliquota: 2, servicos: [{ id: "i1", descricao: "Serviço", quantidade: 1, valorUnitario: 100, valorTotal: 100 }], produtos: [], ordensServicoIds: [] },
    });
    respostas["PUT /api/orcamentos/o1"] = { status: 200, corpo: { id: "o1" } };
    expect($("[data-iss-diferente]")?.textContent).toContain("usa ISS de 2%; a empresa hoje usa 3%");
    expect(valor("iss")).toBe("+ R$ 2,00");
    await clicar(botao("Usar 3%"));
    expect(valor("iss")).toBe("+ R$ 3,00");
    await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await esperar();
    expect(chamadas.find((c) => c.metodo === "PUT")?.corpo.atualizarIss).toBe(true);
  });
});

describe("Gerar descrição profissional (IA)", () => {
  it("sem chave: botão desabilitado e aviso 'IA não configurada'", async () => {
    await montar({ iaDisponivel: false });
    expect($<HTMLButtonElement>("[data-gerar-descricao-ia]")!.disabled).toBe(true);
    expect($("[data-ia-indisponivel]")?.textContent).toBe("IA não configurada");
  });

  it("descrição vazia: preenche com o texto da IA (pedido leva a OS e os itens, sem preços)", async () => {
    respostas["POST /api/orcamentos/descricao-ia"] = { status: 200, corpo: { descricao: "Proposta para limpeza do split." } };
    await montar({ iaDisponivel: true, embutido: { osId: "os1", onSalvo: () => {}, onCancelar: () => {} }, osInicialId: "os1" });
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    await clicar($("[data-gerar-descricao-ia]"));
    const pedido = chamadas.find((c) => c.url === "/api/orcamentos/descricao-ia")!;
    expect(pedido.corpo).toEqual({ osId: "os1", nome: null, servicos: [{ descricao: "Limpeza de split", observacao: null }], produtos: [] });
    expect($<HTMLTextAreaElement>("[data-descricao-orcamento] textarea")!.value).toBe("Proposta para limpeza do split.");
    expect($("[data-gerar-descricao-ia]")?.textContent).toContain("Gerar outra descrição (IA)");
  });

  it("com texto já escrito: só sugere; 'Descartar' mantém; 'Substituir' pede confirmação", async () => {
    respostas["POST /api/orcamentos/descricao-ia"] = { status: 200, corpo: { descricao: "Texto da IA." } };
    await montar({ iaDisponivel: true });
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const area = () => $<HTMLTextAreaElement>("[data-descricao-orcamento] textarea")!;
    await digitar(area(), "Meu texto");
    await clicar($("[data-gerar-descricao-ia]"));
    expect(area().value).toBe("Meu texto");
    expect($("[data-sugestao-ia]")?.textContent).toContain("Texto da IA.");
    await clicar(botao("Descartar"));
    expect($("[data-sugestao-ia]")).toBeNull();
    expect(area().value).toBe("Meu texto");
    await clicar($("[data-gerar-descricao-ia]"));
    (globalThis.confirm as any).mockReturnValueOnce(false);
    await clicar(botao("Substituir a descrição"));
    expect(area().value).toBe("Meu texto");
    await clicar(botao("Substituir a descrição"));
    expect(area().value).toBe("Texto da IA.");
    expect($("[data-sugestao-ia]")).toBeNull();
  });

  it("erro do servidor vira toast; nada muda na descrição", async () => {
    respostas["POST /api/orcamentos/descricao-ia"] = { status: 503, corpo: { erro: "IA não configurada." } };
    await montar({ iaDisponivel: true });
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const { Avisos } = await import("@/components/ui/avisos");
    const host = document.createElement("div"); document.body.appendChild(host);
    const r2 = createRoot(host);
    await act(async () => { r2.render(createElement(Avisos)); });
    await clicar($("[data-gerar-descricao-ia]"));
    expect(document.body.textContent).toContain("IA não configurada.");
    expect($<HTMLTextAreaElement>("[data-descricao-orcamento] textarea")!.value).toBe("");
    act(() => r2.unmount());
  });
});

describe("documento do orçamento: cliente (ISS embutido) × interno (linha de ISS)", () => {
  const orcamento = {
    codigo: "ORC-2026-0001", nome: "Corretiva UTI", status: "ENVIADO", criadoEm: "2026-10-26T12:00:00Z",
    totalServicos: 1000, totalProdutos: 200, totalGeral: 1125,
    descontoServicos: 10, tipoDescontoServicos: "PERCENTUAL", descontoProdutos: 20, tipoDescontoProdutos: "VALOR", issAliquota: 5,
    servicos: [
      { descricao: "Limpeza de split", quantidade: 2, valorUnitario: 450, valorTotal: 900, observacao: "Inclui deslocamento" },
      { descricao: "Carga de gás", quantidade: 3, valorUnitario: 33.33, valorTotal: 100 },
    ],
    produtos: [{ descricao: "Capacitor", quantidade: 4, valorUnitario: 50, valorTotal: 200 }],
  };
  const empresa = { nome: "Clima Total", cnpj: "12345678000190" };
  const cliente = { nome: "Hospital", cpfCnpj: "11222333000181" };
  const html = async (versao: "cliente" | "interna") => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento, { orcamento, empresa, cliente, versao }));
    return div;
  };
  const texto = (el: Element) => (el.textContent ?? "").replace(/\s/g, " ");

  it("cliente: sem a palavra ISS, preços dos serviços com o imposto embutido, contas fechando, nota discreta", async () => {
    const d = await html("cliente");
    expect(texto(d)).not.toMatch(/ISS/);
    expect(d.querySelector("[data-impostos-inclusos]")?.textContent).toBe("Valores com impostos inclusos.");
    const linhasServ = [...d.querySelectorAll("tbody")][0].querySelectorAll("tr");
    // 900 e 100 crescem 5% (ISS) → 945 e 105; subtotal 1050; desconto 105; total 945
    expect(texto(linhasServ[0])).toContain("R$ 472,50");
    expect(texto(linhasServ[0])).toContain("R$ 945,00");
    expect(texto(linhasServ[1])).toContain("R$ 105,00");
    const rodape = texto([...d.querySelectorAll("tfoot")][0]);
    expect(rodape).toContain("Subtotal serviços");
    expect(rodape).toContain("R$ 1.050,00");
    expect(rodape).toContain("− R$ 105,00");
    expect(rodape).toContain("Total serviços");
    expect(rodape).toContain("R$ 945,00");
    expect(d.querySelector("[data-total-geral]")?.textContent?.replace(/\s/g, " ")).toBe("R$ 1.125,00");
    expect(texto(d)).toContain("Inclui deslocamento");
  });

  it("interno: preços como gravados, linha 'ISS (5%)' com o valor e o mesmo total geral", async () => {
    const d = await html("interna");
    expect(d.querySelector("[data-impostos-inclusos]")).toBeNull();
    expect(texto(d.querySelector("[data-linha-iss-documento]")!)).toContain("ISS (5%)");
    expect(texto(d.querySelector("[data-linha-iss-documento]")!)).toContain("+ R$ 45,00");
    const linhasServ = [...d.querySelectorAll("tbody")][0].querySelectorAll("tr");
    expect(texto(linhasServ[0])).toContain("R$ 450,00");
    expect(texto(linhasServ[1])).toContain("R$ 33,33");
    expect(texto(linhasServ[1])).toContain("R$ 100,00");
    expect(texto([...d.querySelectorAll("tfoot")][0])).toContain("Total serviços (com ISS)");
    expect(d.querySelector("[data-total-geral]")?.textContent?.replace(/\s/g, " ")).toBe("R$ 1.125,00");
  });
});

describe("ajustes finos: nome automático, condições, observação ao lado, tipo na OS", () => {
  const CTX = { tipoOs: "Manutenção Corretiva", unidade: "Bloco A", equipamento: "Samsung WindFree 18k" };

  it("nome automático: prévia instantânea no campo; em branco vai vazio (o servidor compõe a mesma regra)", async () => {
    await montar({ contextoNome: CTX, embutido: { osId: "os1", onSalvo: () => {}, onCancelar: () => {} }, osInicialId: "os1" });
    const campo = $<HTMLInputElement>("input[data-nome-orcamento]")!;
    expect(campo.placeholder).toBe("Manutenção Corretiva — Samsung WindFree 18k — Hospital Santa Clara · Bloco A");
    expect(campo.value).toBe("");
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await esperar();
    const corpo = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/orcamentos")!.corpo;
    expect(corpo.nome).toBeNull();
    expect(document.body.textContent).not.toContain("Informe o nome");
  });

  it("sem OS: a prévia usa o 1º item e o cliente; o nome digitado é respeitado", async () => {
    await montar();
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    await adicionar("Buscar produto por nome...", "Capacitor 35uF");
    expect($<HTMLInputElement>("input[data-nome-orcamento]")!.placeholder).toBe("Limpeza de split + 1 item — Hospital Santa Clara");
    const corpo = await salvar(); // digita "Corretiva UTI"
    expect(corpo.nome).toBe("Corretiva UTI");
  });

  it("prazo de execução e forma de pagamento (com sugestões) vão no payload; somem na Proposta de Contrato", async () => {
    await montar();
    expect([...document.querySelectorAll("#sugestoes-forma-pagamento option")].map((o) => o.getAttribute("value"))).toContain("PIX à vista");
    await digitar($("[data-prazo-execucao]"), "5 dias úteis após aprovação");
    await digitar($("[data-forma-pagamento]"), "PIX à vista");
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const corpo = await salvar();
    expect(corpo).toMatchObject({ prazoExecucao: "5 dias úteis após aprovação", formaPagamento: "PIX à vista" });
    await clicar($$("button").find((b) => b.textContent?.includes("Proposta de Contrato")));
    expect($("[data-prazo-execucao]")).toBeNull();
    expect($("[data-forma-pagamento]")).toBeNull();
  });

  it("dentro da OS: só 'Orçamento' (nada de Proposta de Contrato nem 'Orçamento comum'); no Comercial o rótulo é 'Orçamento'", async () => {
    await montar({ embutido: { osId: "os1", onSalvo: () => {}, onCancelar: () => {} }, osInicialId: "os1" });
    expect(document.body.textContent).not.toMatch(/Proposta de Contrato|Orçamento [Cc]omum/);
    act(() => root.unmount()); caixa.remove();
    await montar();
    const tipos = $$("button").filter((b) => /Proposta comercial avulsa|Contrato de manutenção/.test(b.textContent ?? "")).map((b) => b.querySelector("p")?.textContent);
    expect(tipos).toEqual(["Orçamento", "Proposta de Contrato"]);
  });

  it("observação na coluna ao lado da descrição (cabeçalho Descrição | Observação | Qtd | Unitário | Total), na mesma linha do item", async () => {
    await montar();
    await adicionar("Buscar serviço por nome...", "Limpeza de split");
    const cabecalho = $$("[role='table'][aria-label='Serviços'] [role='columnheader']").map((c) => c.textContent);
    expect(cabecalho.slice(0, 5)).toEqual(["Descrição", "Observação", "Qtd", "Unitário", "Total"]);
    const linha = linhas()[0];
    const celulas = [...linha.querySelectorAll(":scope > [role='cell']")];
    expect(celulas[1].querySelector("textarea[aria-label='Observação de Limpeza de split']")).toBeTruthy(); // 2ª coluna = observação
    await digitar(celulas[1].querySelector("textarea"), "Inclui deslocamento");
    const corpo = await salvar();
    expect(corpo.servicos[0].observacao).toBe("Inclui deslocamento");
  });
});
