// @vitest-environment happy-dom
/**
 * Proposta corporativa num DOM de verdade:
 *  - construtor: o orçamento novo abre com os padrões (validade em dias, garantias, não incluso,
 *    normas, RT padrão) e o destinatário sugerido; sugestões do "Não incluso" acrescentam linha;
 *    "Para:" (unidade/contato) vem da rota de orçamentos e trocar de cliente solta a escolha; tudo
 *    vai no payload; na Proposta de Contrato os blocos novos somem;
 *  - Configurações › Orçamentos: salva os padrões; sem gerenciar = só leitura;
 *  - anexos da proposta: rascunho edita (enviar, fotos da OS, tirar); enviado = só leitura;
 *  - documento: observações internas só na versão interna; Nº formal no lugar do código.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais } from "@/lib/permissoes";
import { chaveHojeBR } from "@/lib/fuso";
import { validadePadrao } from "@/lib/orcamentos/calculo";

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
  clientes: [
    { id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" },
    { id: "c2", nome: "Padaria Pão Quente" },
  ],
  catalogoServicos: [{ id: "s1", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 500 }],
  catalogoProdutos: [],
  tecnicos: [{ id: "rt1", nome: "Eng. Roberto Mendes", crea: "5012345-D/SP" }, { id: "rt2", nome: "Eng. Ana Lima", crea: null }],
  termoTemplates: [], clienteIdInicial: "c1",
};
const PADROES = {
  validadeDias: 15, garantiaServico: "90 dias", garantiaPecas: "Conforme garantia do fabricante",
  naoIncluso: "Obra civil (alvenaria, forro, pintura e acabamentos)", normas: ["PMOC"], responsavelTecnicoId: "rt1",
};
const DESTINOS_C1 = {
  unidades: [{ id: "un1", nome: "Matriz", principal: true, cidade: "Belo Horizonte", estado: "MG" }, { id: "un3", nome: "Anexo", principal: false, cidade: null, estado: null }],
  contatos: [{ id: "ct1", nome: "Juliana Ramos", cargo: "Compras", principal: true, email: null }],
};

beforeAll(async () => {
  await Promise.all([
    import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider"),
    import("@/components/config/orcamento-padroes-client"), import("@/components/orcamento/anexos-proposta"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  respostas = {
    "GET /api/clientes/c1/tabela-preco": { status: 200, corpo: null },
    "GET /api/orcamentos/destinatario?clienteId=c1": { status: 200, corpo: DESTINOS_C1 },
    "GET /api/orcamentos/destinatario?clienteId=c2": { status: 200, corpo: { unidades: [{ id: "un2", nome: "Loja", principal: true, cidade: null, estado: null }], contatos: [] } },
    "POST /api/orcamentos": { status: 201, corpo: { id: "o1" } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body && typeof init.body === "string" ? JSON.parse(init.body) : init.body ?? null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function renderizar(el: React.ReactElement) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: el })); });
  await esperar();
}
async function montarForm(props: Record<string, unknown> = {}) {
  const { OrcamentoForm } = await import("@/components/forms/orcamento-form");
  await renderizar(createElement(OrcamentoForm as any, { mode: "novo", ...BASE, padroes: PADROES, destinatarioInicial: { unidadeId: "un1", contatoClienteId: "ct1" }, ...props }));
}
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(sel: HTMLSelectElement | null, v: string) {
  expect(sel).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
async function adicionarServico() {
  await digitar($("input[placeholder='Buscar serviço por nome...']"), "Limpe");
  await clicar($$("button").find((b) => b.textContent?.includes("Limpeza de split")));
}
async function salvar() {
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await esperar();
  return chamadas.find((c) => c.metodo === "POST" && c.url === "/api/orcamentos")?.corpo;
}

describe("construtor: padrões, destinatário e campos corporativos", () => {
  it("o novo abre com os padrões de Configurações (validade em dias, garantias, não incluso, normas, RT) e tudo vai no payload", async () => {
    await montarForm();
    const alvo = validadePadrao(chaveHojeBR(), 15);
    expect($<HTMLInputElement>("input[aria-label='Validade']")!.value).toBe(`${alvo.slice(8, 10)}/${alvo.slice(5, 7)}/${alvo.slice(0, 4)}`);
    expect(document.body.textContent).toContain("Padrão: 15 dias após a data do orçamento");
    expect($<HTMLInputElement>("[data-garantia-servico]")!.value).toBe("90 dias");
    expect($<HTMLInputElement>("[data-garantia-pecas]")!.value).toBe("Conforme garantia do fabricante");
    expect($<HTMLTextAreaElement>("[data-nao-incluso] textarea")!.value).toBe(PADROES.naoIncluso);
    expect($$<HTMLInputElement>("[data-norma]").filter((c) => c.checked).map((c) => c.dataset.norma)).toEqual(["PMOC"]);
    expect($<HTMLSelectElement>("[data-rt-orcamento]")!.value).toBe("rt1");
    expect($<HTMLSelectElement>("[data-unidade-orcamento]")!.value).toBe("un1");
    expect($<HTMLSelectElement>("[data-contato-orcamento]")!.value).toBe("ct1");
    expect(chamadas.some((c) => c.url === "/api/orcamentos/destinatario?clienteId=c1")).toBe(true);
    await adicionarServico();
    const corpo = await salvar();
    expect(corpo).toMatchObject({
      validadeEm: alvo, garantiaServico: "90 dias", garantiaPecas: "Conforme garantia do fabricante", naoIncluso: PADROES.naoIncluso,
      normas: ["PMOC"], responsavelTecnicoId: "rt1", artNumero: null, unidadeId: "un1", contatoClienteId: "ct1",
    });
  });

  it("sugestão do 'Não incluso' acrescenta a linha (e fica marcada); normas ligam/desligam; ART e RT editáveis", async () => {
    await montarForm({ padroes: { ...PADROES, naoIncluso: null, normas: [] } });
    const sug = $<HTMLButtonElement>("[data-sugestao-nao-incluso='Infraestrutura elétrica além do ponto de força']")!;
    await clicar(sug);
    // As menos comuns ficam em "mais sugestões"
    expect($("[data-sugestao-nao-incluso='Taxas de acesso, liberação ou integração no local']")).toBeNull();
    await clicar($("[data-mais-sugestoes-nao-incluso]"));
    await clicar($("[data-sugestao-nao-incluso='Taxas de acesso, liberação ou integração no local']"));
    expect($<HTMLTextAreaElement>("[data-nao-incluso] textarea")!.value).toBe("Infraestrutura elétrica além do ponto de força\nTaxas de acesso, liberação ou integração no local");
    expect($<HTMLButtonElement>("[data-sugestao-nao-incluso='Infraestrutura elétrica além do ponto de força']")!.disabled).toBe(true);
    await clicar($("[data-norma='NBR_13971']"));
    await clicar($("[data-norma='NBR_16401']"));
    await clicar($("[data-norma='PMOC']"));
    await clicar($("[data-norma='PMOC']")); // marca e desmarca
    await escolher($("[data-rt-orcamento]"), "rt2");
    await digitar($("[data-art-orcamento]"), " 2620261234567 ");
    await adicionarServico();
    const corpo = await salvar();
    expect(corpo).toMatchObject({ normas: ["NBR_16401", "NBR_13971"], responsavelTecnicoId: "rt2", artNumero: "2620261234567" });
    expect(corpo.naoIncluso.split("\n")).toHaveLength(2);
  });

  it("garantia apagada vai nula; trocar de cliente solta unidade/contato e carrega as opções do novo cliente", async () => {
    await montarForm();
    await digitar($("[data-garantia-servico]"), "  ");
    // Seletor de cliente (lista própria): abre e escolhe o outro cliente
    await clicar($$("button").find((b) => b.textContent?.includes("Hospital Santa Clara")));
    await clicar($$("button").find((b) => b.textContent?.trim() === "Padaria Pão Quente"));
    expect(chamadas.some((c) => c.url === "/api/orcamentos/destinatario?clienteId=c2")).toBe(true);
    expect($<HTMLSelectElement>("[data-unidade-orcamento]")!.value).toBe("");
    expect($<HTMLSelectElement>("[data-contato-orcamento]")!.value).toBe("");
    expect([...$<HTMLSelectElement>("[data-unidade-orcamento]")!.options].map((o) => o.textContent)).toEqual(["Endereço do cliente", "Loja"]);
    await adicionarServico();
    const corpo = await salvar();
    expect(corpo.garantiaServico).toBeNull();
    expect([corpo.clienteId, corpo.unidadeId, corpo.contatoClienteId]).toEqual(["c2", null, null]);
  });

  it("Proposta de Contrato: os blocos do orçamento comum (condições, normas, Para:) somem", async () => {
    await montarForm();
    expect($("[data-condicoes-comerciais]")).toBeTruthy();
    await clicar($$("button").find((b) => b.textContent?.includes("Proposta de Contrato")));
    expect($("[data-condicoes-comerciais]")).toBeNull();
    expect($("[data-destinatario]")).toBeNull();
  });

  it("edição: abre com o que o orçamento gravou (não com os padrões)", async () => {
    await montarForm({
      mode: "editar",
      inicial: {
        id: "o9", nome: "X", clienteId: "c1", descontoServicos: 0, tipoDescontoServicos: "VALOR", descontoProdutos: 0, tipoDescontoProdutos: "VALOR",
        issAliquota: 0, servicos: [], produtos: [], ordensServicoIds: [], garantiaServico: null, garantiaPecas: "12 meses", naoIncluso: null, normas: [],
        unidadeId: "un3", contatoClienteId: null, proposta: { responsavelTecnicoId: null, artNumero: null },
      },
    });
    expect($<HTMLInputElement>("[data-garantia-servico]")!.value).toBe("");
    expect($<HTMLInputElement>("[data-garantia-pecas]")!.value).toBe("12 meses");
    expect($$<HTMLInputElement>("[data-norma]").some((c) => c.checked)).toBe(false);
    expect($<HTMLSelectElement>("[data-rt-orcamento]")!.value).toBe("");
    expect($<HTMLSelectElement>("[data-unidade-orcamento]")!.value).toBe("un3");
  });
});

describe("Configurações › Orçamentos e propostas", () => {
  const INICIAL = { orcamentoValidadeDias: 10, orcamentoGarantiaServico: "90 dias", orcamentoGarantiaPecas: null, orcamentoNaoIncluso: null, orcamentoNormas: [] };
  it("salva validade, garantias, não incluso e normas", async () => {
    const { OrcamentoPadroesClient } = await import("@/components/config/orcamento-padroes-client");
    respostas["PUT /api/configuracoes"] = { status: 200, corpo: {} };
    await renderizar(createElement(OrcamentoPadroesClient, { inicial: INICIAL, podeEditar: true }));
    await digitar($("[data-validade-dias]"), "20");
    await digitar($("[data-garantia-pecas]"), "6 meses");
    await clicar($("[data-sugestao-nao-incluso='Remoção e descarte do equipamento antigo']"));
    await clicar($("[data-norma='PMOC']"));
    await clicar($("[data-salvar-padroes-orcamento]"));
    const put = chamadas.find((c) => c.metodo === "PUT" && c.url === "/api/configuracoes")!.corpo;
    expect(put).toEqual({
      orcamentoValidadeDias: "20", orcamentoGarantiaServico: "90 dias", orcamentoGarantiaPecas: "6 meses",
      orcamentoNaoIncluso: "Remoção e descarte do equipamento antigo", orcamentoNormas: ["PMOC"],
    });
    expect(document.body.textContent).toContain("Padrões salvos");
  });
  it("erro do servidor aparece; sem permissão de gerenciar = só leitura (sem botão salvar)", async () => {
    const { OrcamentoPadroesClient } = await import("@/components/config/orcamento-padroes-client");
    respostas["PUT /api/configuracoes"] = { status: 400, corpo: { erro: "A validade vai de 1 a 365 dias" } };
    await renderizar(createElement(OrcamentoPadroesClient, { inicial: INICIAL, podeEditar: true }));
    await clicar($("[data-salvar-padroes-orcamento]"));
    expect(document.body.textContent).toContain("A validade vai de 1 a 365 dias");
    act(() => root.unmount()); caixa.remove();
    await renderizar(createElement(OrcamentoPadroesClient, { inicial: INICIAL, podeEditar: false }));
    expect($("[data-salvar-padroes-orcamento]")).toBeNull();
    expect($<HTMLFieldSetElement>("[data-padroes-orcamento] fieldset")!.disabled).toBe(true);
    expect(document.body.textContent).toContain("Somente leitura");
  });
});

describe("anexos da proposta (tela do orçamento)", () => {
  const LISTA = [
    { id: "f1", tipo: "FOTO", nome: "Foto 1", mime: "image/png", tamanho: 1000, legenda: "Antes do serviço", origem: "OS-2026-0001" },
    { id: "a1", tipo: "ARQUIVO", nome: "Datasheet.pdf", mime: "application/pdf", tamanho: 250_000, legenda: null, origem: null },
  ];
  it("rascunho: lista fotos e arquivos; 'Fotos da OS' copia as escolhidas; tirar pede confirmação", async () => {
    const { AnexosProposta } = await import("@/components/orcamento/anexos-proposta");
    respostas["GET /api/orcamentos/o1/anexos"] = { status: 200, corpo: LISTA };
    respostas["GET /api/orcamentos/o1/anexos/fotos-os"] = { status: 200, corpo: [{ os: { id: "os1", numero: "OS-2026-0001" }, fotos: [
      { origem: "EXECUCAO", id: "fa1", src: "/api/fotos-atendimento/fa1", legenda: "Antes do serviço", equipamento: "Samsung WindFree" },
      { origem: "ANEXO", id: "oa1", src: "/x", legenda: "Condensadora", equipamento: null },
    ] }] };
    respostas["POST /api/orcamentos/o1/anexos/fotos-os"] = { status: 201, corpo: [] };
    await renderizar(createElement(AnexosProposta, { orcamentoId: "o1", editavel: true, temOs: true, podeVerOs: true }));
    expect($$("[data-anexo-foto]")).toHaveLength(1);
    expect($("[data-anexo-arquivo]")!.textContent).toContain("Datasheet.pdf");
    expect($("[data-anexo-arquivo]")!.textContent).toContain("244 KB");
    await clicar($("[data-escolher-fotos-os]"));
    expect($$("[data-foto-os]")).toHaveLength(2);
    await clicar($("[data-foto-os='ANEXO:oa1'] input"));
    await clicar($("[data-confirmar-fotos-os]"));
    expect(chamadas.find((c) => c.metodo === "POST" && c.url.endsWith("/fotos-os"))!.corpo).toEqual({ fotos: [{ origem: "ANEXO", id: "oa1" }] });
    expect(nav.refresh).toHaveBeenCalled();
  });
  it("enviado: só consulta (sem enviar/fotos/tirar); sem permissão de ver OS: sem 'Fotos da OS'", async () => {
    const { AnexosProposta } = await import("@/components/orcamento/anexos-proposta");
    respostas["GET /api/orcamentos/o1/anexos"] = { status: 200, corpo: LISTA };
    await renderizar(createElement(AnexosProposta, { orcamentoId: "o1", editavel: false, temOs: true, podeVerOs: true }));
    expect($("[data-enviar-anexo]")).toBeNull();
    expect($("[data-escolher-fotos-os]")).toBeNull();
    expect($$("button[aria-label^='Tirar']")).toHaveLength(0);
    expect($("[data-anexos-somente-leitura]")).toBeTruthy();
    act(() => root.unmount()); caixa.remove();
    await renderizar(createElement(AnexosProposta, { orcamentoId: "o1", editavel: true, temOs: true, podeVerOs: false }));
    expect($("[data-enviar-anexo]")).toBeTruthy();
    expect($("[data-escolher-fotos-os]")).toBeNull();
  });
});

describe("documento: versão do cliente × interna", () => {
  const orcamento = {
    codigo: "ORC-2026-0147", nome: "Corretiva UTI", status: "ENVIADO", criadoEm: "2026-10-26T12:00:00Z", observacao: "Margem apertada",
    totalServicos: 100, totalProdutos: 0, totalGeral: 100, servicos: [{ descricao: "Limpeza", quantidade: 1, valorUnitario: 100, valorTotal: 100 }], produtos: [],
  };
  const html = async (versao: "cliente" | "interna") => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    return renderToStaticMarkup(createElement(OrcamentoDocumento, { orcamento, empresa: { nome: "Clima Total", cnpj: "12345678000190" }, cliente: { nome: "Hospital", cpfCnpj: "11222333000181" }, versao }));
  };
  it("Nº formal no cabeçalho; observações internas e status só na versão interna", async () => {
    const c = await html("cliente");
    expect(c).toContain("2026-0147");
    expect(c).not.toContain("ORC-2026-0147");
    expect(c).not.toContain("Margem apertada");
    expect(c).not.toContain("Enviado");
    const i = await html("interna");
    expect(i).toContain("Margem apertada");
    expect(i).toContain("Enviado");
  });
});
