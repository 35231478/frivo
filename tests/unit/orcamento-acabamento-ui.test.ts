// @vitest-environment happy-dom
/**
 * Acabamento do documento e da listagem num DOM de verdade:
 *  - documento: tabela estilo planilha (#, Qtd/Unitário/Total à direita, sem "R$" nas células,
 *    zebrado, quantidades alinhadas pela vírgula), TOTAL GERAL sóbrio, "Para:" com hierarquia,
 *    "Dados para pagamento" em duas colunas alinhadas; ISS continua embutido no do cliente;
 *  - forma de pagamento: lista com uma escolha, parcelas (2x–12x) quando é parcelado, "Outro" com
 *    texto livre; texto antigo abre como "Outro";
 *  - "Não incluso": mais sugestões escondidas atrás de "Mais N sugestões";
 *  - ações da linha da lista: baixar PDF, enviar por e-mail e por WhatsApp (mesma rota de envio),
 *    sem permissão = só o PDF, bloqueado (encerrado/vencido) = desabilitado com o motivo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const r = respostas[`${metodo} ${url}`] ?? { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function renderizar(el: React.ReactElement) {
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(el); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(sel: Element | null | undefined, v: string) {
  expect(sel).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
    sel!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe("documento: planilha, total, Para: e dados para pagamento", () => {
  const orcamento = {
    codigo: "ORC-2026-0147", nome: "Manutenção Corretiva — Hospital Santa Clara", status: "ENVIADO", criadoEm: "2026-10-26T12:00:00Z",
    totalServicos: 1000, totalProdutos: 105, totalGeral: 1155, issAliquota: 5,
    servicos: [
      { descricao: "Limpeza de split", quantidade: 2, valorUnitario: 450, valorTotal: 900, observacao: "Inclui deslocamento" },
      { descricao: "Carga de gás", quantidade: 1, valorUnitario: 100, valorTotal: 100 },
    ],
    produtos: [
      { descricao: "Tubo de cobre 1/4\"", quantidade: 2.5, valorUnitario: 30, valorTotal: 75 },
      { descricao: "Capacitor", quantidade: 1, valorUnitario: 30, valorTotal: 30 },
    ],
    unidade: { nome: "Matriz", logradouro: "Av. Afonso Pena", numero: "2300", cidade: "Belo Horizonte", estado: "MG" },
    contatoCliente: { nome: "Juliana Ramos", cargo: "Compras", email: "compras@hsc.com.br", telefone: "31988887777" },
  };
  const empresa = { nome: "Clima Total Ltda", nomeFantasia: "Clima Total", cnpj: "12345678000190", bancoNome: "Banco Inter (077)", bancoAgencia: "0001", bancoConta: "12345-6", bancoTipoConta: "Corrente", pixChave: "pix@clima.com" };
  const cliente = { nome: "Hospital Santa Clara S/A", nomeFantasia: "Hospital Santa Clara", cpfCnpj: "22101333000111", inscricaoEstadual: "ISENTO" };
  const html = async (versao: "cliente" | "interna", extra: Record<string, unknown> = {}, emp: Record<string, unknown> = empresa) => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const d = document.createElement("div");
    d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, { orcamento: { ...orcamento, ...extra }, empresa: emp, cliente, versao }));
    document.body.appendChild(d);
    return d;
  };

  it("tabela estilo planilha: # e colunas numéricas à direita, sem 'R$' nas células, zebrado e fios finos", async () => {
    const d = await html("cliente");
    const tab = d.querySelector("[data-grupo-documento='serviços'] table[data-tabela-planilha]")!;
    expect([...tab.querySelectorAll("thead th")].map((th) => [th.textContent, th.className.includes("text-right")])).toEqual([
      ["#", true], ["Descrição", false], ["Qtd", true], ["Unitário (R$)", true], ["Total (R$)", true],
    ]);
    expect(tab.className).toMatch(/text-\[13px\]/);
    expect(tab.className).toMatch(/print:text-\[11px\]/);
    const linhas = [...tab.querySelectorAll("tbody tr[data-linha-item]")];
    expect(linhas).toHaveLength(2);
    for (const tr of linhas) {
      expect(tr.className).toContain("even:bg-surface-alt/60"); // zebrado
      expect(tr.className).toContain("border-surface-linha"); // fio fino
      expect(tr.className).toContain("break-inside-avoid"); // linha nunca cortada na quebra de página
      for (const k of ["qtd", "unitario", "total-item"]) {
        const td = tr.querySelector(`[data-${k}]`)!;
        expect(td.className).toContain("text-right");
        expect(td.className).toContain("tabular-nums");
        expect(td.textContent).not.toContain("R$");
      }
    }
    // Cliente: ISS (5%) embutido nos serviços — 450 → 472,50 — e nenhuma linha de ISS
    expect([linhas[0].querySelector("td")!.textContent, linhas[0].querySelector("[data-unitario]")!.textContent, linhas[0].querySelector("[data-total-item]")!.textContent]).toEqual(["1", "472,50", "945,00"]);
    expect(texto(d)).not.toMatch(/ISS/);
    expect(d.querySelector("[data-linha-iss-documento]")).toBeNull();
  });

  it("quantidades alinhadas pela vírgula no grupo (2,5 e 1,0); grupo inteiro sem casas", async () => {
    const d = await html("cliente");
    const qtd = (g: string) => [...d.querySelectorAll(`[data-grupo-documento='${g}'] [data-qtd]`)].map((td) => td.textContent);
    expect(qtd("produtos")).toEqual(["2,5", "1,0"]);
    expect(qtd("serviços")).toEqual(["2", "1"]);
    // No celular, Qtd × Unitário vai embaixo da descrição (com R$)
    expect(texto(d.querySelector("[data-grupo-documento='produtos'] [data-qtd-unitario-celular]"))).toBe("2,5 × R$ 30,00");
  });

  it("TOTAL GERAL destacado mas sóbrio: tom primário, tamanho contido, nada do verde gigante", async () => {
    const d = await html("cliente");
    const v = d.querySelector("[data-total-geral]")!;
    expect(v.textContent?.replace(/\s/g, " ")).toBe("R$ 1.155,00");
    expect(v.className).toContain("text-lg");
    expect(v.className).toContain("text-primary-700");
    expect(v.className).not.toMatch(/text-2xl|text-3xl|success/);
    expect(v.parentElement!.className).toContain("bg-primary-50");
    expect(texto(d.querySelector("[data-totais-documento]"))).toContain("Total serviçosR$ 1.050,00Total produtosR$ 105,00Total geralR$ 1.155,00");
  });

  it("Para: razão social em destaque; CNPJ · IE na mesma linha; A/C com contato; local com endereço — alinhados", async () => {
    const d = await html("cliente");
    const para = d.querySelector("[data-para]")!;
    expect(texto(para.querySelector("[data-para-razao]"))).toBe("Hospital Santa Clara S/A");
    expect(para.querySelector("[data-para-razao]")!.className).toContain("font-bold");
    expect(texto(para.querySelector("[data-para-documentos]"))).toBe("CNPJ 22.101.333/0001-11 · IE ISENTO");
    const dl = para.querySelector("dl")!;
    expect(dl.className).toContain("grid-cols-[4.25rem_1fr]");
    expect([...dl.querySelectorAll("dt")].map((dt) => dt.textContent)).toEqual(["A/C", "Local"]);
    expect([...dl.querySelector("[data-para-ac]")!.children].map((c) => c.textContent)).toEqual(["Juliana Ramos (Compras)", "(31) 98888-7777 · compras@hsc.com.br"]);
    expect([...dl.querySelector("[data-para-endereco]")!.children].map((c) => c.textContent)).toEqual(["Matriz", "Av. Afonso Pena, 2300 — Belo Horizonte/MG"]);
  });

  it("Para: sem contato A/C mostra 'Contato'; sem unidade, 'Endereço' do cadastro; sem nada, nenhuma linha", async () => {
    const { OrcamentoDocumento } = await import("@/components/orcamento/orcamento-documento");
    const render = (cli: Record<string, unknown>) => {
      const d = document.createElement("div");
      d.innerHTML = renderToStaticMarkup(createElement(OrcamentoDocumento as any, { orcamento: { ...orcamento, unidade: null, contatoCliente: null }, empresa, cliente: cli, versao: "cliente" }));
      return d;
    };
    let d = render({ ...cliente, email: "geral@hsc.com.br", endereco: "Rua A", numero: "10", cidade: "BH", estado: "MG" });
    expect([...d.querySelectorAll("[data-para] dt")].map((dt) => dt.textContent)).toEqual(["Contato", "Endereço"]);
    expect(d.querySelector("[data-para-ac]")).toBeNull();
    d = render({ nome: "Fulano", cpfCnpj: "12345678909" });
    expect(d.querySelector("[data-para] dl")).toBeNull();
    expect(texto(d.querySelector("[data-para-documentos]"))).toBe("CPF 123.456.789-09");
  });

  it("dados para pagamento em duas colunas alinhadas: conta | favorecido (titular, CNPJ, PIX)", async () => {
    const d = await html("cliente");
    const bloco = d.querySelector("[data-dados-bancarios]")!;
    const col = (c: string) => [...bloco.querySelectorAll(`[data-coluna-banco='${c}'] dt`)].map((dt) => `${dt.textContent}=${dt.nextElementSibling?.textContent}`);
    expect(col("conta")).toEqual(["Banco=Banco Inter (077)", "Agência=0001", "Conta corrente=12345-6"]);
    expect(col("favorecido")).toEqual(["Titular=Clima Total Ltda", "CNPJ=12.345.678/0001-90", "Chave PIX=pix@clima.com"]);
    for (const dl of bloco.querySelectorAll("dl")) expect(dl.className).toContain("grid-cols-[6.5rem_1fr]");
    // Só PIX: só a coluna do favorecido
    const s = await html("cliente", {}, { nome: "Clima Total Ltda", cnpj: "12345678000190", pixChave: "pix@clima.com" });
    expect(s.querySelector("[data-coluna-banco='conta']")).toBeNull();
    expect(s.querySelector("[data-coluna-banco='favorecido']")).toBeTruthy();
  });

  it("versão interna mantém a linha de ISS (e o mesmo total geral)", async () => {
    const d = await html("interna");
    expect(texto(d.querySelector("[data-linha-iss-documento]"))).toContain("ISS (5%)+ R$ 50,00");
    expect(d.querySelector("[data-total-geral]")?.textContent?.replace(/\s/g, " ")).toBe("R$ 1.155,00");
    expect(d.querySelector("[data-grupo-documento='serviços'] [data-unitario]")!.textContent).toBe("450,00");
  });
});

describe("forma de pagamento (uma escolha)", () => {
  const montar = async (inicial: string) => {
    const { FormaPagamentoCampo } = await import("@/components/orcamento/campos-corporativos");
    const valores: string[] = [];
    function Teste() {
      const [v, setV] = useState(inicial);
      return createElement("div", null,
        createElement(FormaPagamentoCampo, { valor: v, onChange: (t: string) => { valores.push(t); setV(t); }, id: "fp" }),
        createElement("output", { "data-valor": "" }, v));
    }
    await renderizar(createElement(Teste));
    return valores;
  };
  const valor = () => $("[data-valor]")!.textContent;

  it("lista com todas as opções + 'Não informar' e 'Outro'; escolher uma grava o texto do documento", async () => {
    await montar("");
    const opcoes = $$<HTMLOptionElement>("[data-forma-pagamento-opcao] option").map((o) => o.textContent);
    expect(opcoes[0]).toBe("Não informar");
    expect(opcoes.at(-1)).toBe("Outro (digitar)");
    expect(opcoes).toContain("Parcelado no boleto (2x a 12x)");
    expect(opcoes).toContain("Entrada + saldo na entrega/conclusão");
    expect(opcoes).toHaveLength(13);
    expect($("[data-forma-pagamento-parcelas]")).toBeNull();
    await escolher($("[data-forma-pagamento-opcao]"), "FATURADO_30");
    expect(valor()).toBe("Faturado 30 dias");
  });

  it("parcelado mostra o nº de parcelas (2x a 12x); trocar as parcelas muda o texto", async () => {
    await montar("");
    await escolher($("[data-forma-pagamento-opcao]"), "PARCELADO_BOLETO");
    const parcelas = $<HTMLSelectElement>("[data-forma-pagamento-parcelas]")!;
    expect([...parcelas.options].map((o) => o.value)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
    expect(valor()).toBe("Parcelado no boleto em 3x");
    await escolher(parcelas, "10");
    expect(valor()).toBe("Parcelado no boleto em 10x");
    await escolher($("[data-forma-pagamento-opcao]"), "PIX");
    expect($("[data-forma-pagamento-parcelas]")).toBeNull();
    expect(valor()).toBe("PIX");
    await escolher($("[data-forma-pagamento-opcao]"), "");
    expect(valor()).toBe("");
  });

  it("'Outro' abre o campo livre; texto antigo abre como 'Outro' com o texto; gravado da lista reabre na opção", async () => {
    await montar("PIX à vista ou boleto em 2x");
    expect($<HTMLSelectElement>("[data-forma-pagamento-opcao]")!.value).toBe("OUTRO");
    expect($<HTMLInputElement>("[data-forma-pagamento-outro]")!.value).toBe("PIX à vista ou boleto em 2x");
    await digitar($("[data-forma-pagamento-outro]"), "40% na aprovação e 60% em 30 dias");
    expect(valor()).toBe("40% na aprovação e 60% em 30 dias");
    act(() => root.unmount());
    await montar("Cartão de crédito parcelado em 6x");
    expect($<HTMLSelectElement>("[data-forma-pagamento-opcao]")!.value).toBe("CARTAO_PARCELADO");
    expect($<HTMLSelectElement>("[data-forma-pagamento-parcelas]")!.value).toBe("6");
    expect($("[data-forma-pagamento-outro]")).toBeNull();
  });
});

describe("Não incluso: mais sugestões", () => {
  it("mostra as 8 mais comuns; 'Mais N sugestões' abre o resto e recolhe", async () => {
    const { NaoInclusoCampo } = await import("@/components/orcamento/campos-corporativos");
    const { NAO_INCLUSO_SUGESTOES } = await import("@/lib/orcamentos/proposta");
    function Teste() {
      const [v, setV] = useState("Bomba de dreno");
      return createElement(NaoInclusoCampo, { valor: v, onChange: setV });
    }
    await renderizar(createElement(Teste));
    expect($$("[data-sugestao-nao-incluso]")).toHaveLength(8);
    const mais = $("[data-mais-sugestoes-nao-incluso]")!;
    expect(mais.textContent).toBe(`Mais ${NAO_INCLUSO_SUGESTOES.length - 8} sugestões`);
    expect(mais.getAttribute("aria-expanded")).toBe("false");
    expect($<HTMLButtonElement>("[data-sugestao-nao-incluso='Bomba de dreno']")!.disabled).toBe(true); // já está no texto
    await clicar(mais);
    expect($$("[data-sugestao-nao-incluso]")).toHaveLength(NAO_INCLUSO_SUGESTOES.length);
    await clicar($("[data-sugestao-nao-incluso='Içamento ou guindaste']"));
    expect($<HTMLTextAreaElement>("[data-nao-incluso] textarea")!.value).toBe("Bomba de dreno\nIçamento ou guindaste");
    await clicar($("[data-mais-sugestoes-nao-incluso]"));
    expect($("[data-mais-sugestoes-nao-incluso]")!.textContent).toContain("Mais");
    expect($$("[data-sugestao-nao-incluso]")).toHaveLength(8);
  });
});

describe("ações na linha da lista de orçamentos", () => {
  const ENVIAR = "POST /api/orcamentos/o1/enviar";
  const montar = async (props: Record<string, unknown> = {}) => {
    const { AcoesLinhaOrcamento } = await import("@/components/orcamento/acoes-linha-orcamento");
    const { Avisos } = await import("@/components/ui/avisos");
    await renderizar(createElement("div", null,
      createElement(AcoesLinhaOrcamento, { orcamentoId: "o1", codigo: "ORC-2026-0147", tokenPublico: "tk1", podeEnviar: true, ...props } as any),
      createElement(Avisos)));
  };

  it("baixar PDF: abre a impressão do documento do cliente em outra aba", async () => {
    await montar();
    const a = $<HTMLAnchorElement>("[data-baixar-pdf]")!;
    expect(a.getAttribute("href")).toBe("/orcamento/tk1/imprimir");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("aria-label")).toBe("Baixar PDF do orçamento ORC-2026-0147");
  });

  it("e-mail: chama a rota de envio com o canal, avisa para quem foi e atualiza a lista (status Enviado)", async () => {
    respostas[ENVIAR] = { status: 200, corpo: { emailEnviado: true, para: "compras@hsc.com.br" } };
    await montar();
    await clicar($("[data-enviar-email-linha]"));
    expect(chamadas).toEqual([{ url: "/api/orcamentos/o1/enviar", metodo: "POST", corpo: { canal: "EMAIL" } }]);
    expect(document.body.textContent).toContain("E-mail enviado para compras@hsc.com.br.");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("e-mail sem destinatário ou com erro do servidor: avisa e não atualiza no erro", async () => {
    respostas[ENVIAR] = { status: 200, corpo: { emailEnviado: false, mailtoUrl: null, erroEmail: null } };
    await montar();
    await clicar($("[data-enviar-email-linha]"));
    expect(document.body.textContent).toContain("Cliente sem e-mail cadastrado");
    respostas[ENVIAR] = { status: 403, corpo: { erro: "Sem permissão para editar orçamentos" } };
    await clicar($("[data-enviar-email-linha]"));
    expect(document.body.textContent).toContain("Sem permissão para editar orçamentos");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp: abre a aba já no clique e leva ao wa.me com a mensagem e o link", async () => {
    const aba = { location: { href: "" }, closed: false, close: vi.fn(), opener: {} as unknown };
    const abrir = vi.fn(() => aba);
    vi.stubGlobal("open", abrir);
    respostas[ENVIAR] = { status: 200, corpo: { whatsappUrl: "https://wa.me/5531988887777?text=oi" } };
    await montar();
    await clicar($("[data-enviar-whatsapp-linha]"));
    expect(abrir).toHaveBeenCalledWith("", "_blank");
    expect(aba.opener).toBeNull();
    expect(aba.location.href).toBe("https://wa.me/5531988887777?text=oi");
    expect(chamadas[0].corpo).toEqual({ canal: "WHATSAPP" });
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp sem telefone ou com erro: fecha a aba aberta e avisa", async () => {
    const aba = { location: { href: "" }, closed: false, close: vi.fn(), opener: null };
    vi.stubGlobal("open", vi.fn(() => aba));
    respostas[ENVIAR] = { status: 200, corpo: { whatsappUrl: null } };
    await montar();
    await clicar($("[data-enviar-whatsapp-linha]"));
    expect(aba.close).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Cliente sem telefone/WhatsApp cadastrado");
    respostas[ENVIAR] = { status: 400, corpo: { erro: "Orçamento já encerrado, não é possível reenviar" } };
    await clicar($("[data-enviar-whatsapp-linha]"));
    expect(aba.close).toHaveBeenCalledTimes(2);
    expect(aba.location.href).toBe("");
  });

  it("pop-up bloqueado: abre o wa.me direto depois da resposta", async () => {
    const abrir = vi.fn(() => null);
    vi.stubGlobal("open", abrir);
    respostas[ENVIAR] = { status: 200, corpo: { whatsappUrl: "https://wa.me/55319?text=x" } };
    await montar();
    await clicar($("[data-enviar-whatsapp-linha]"));
    expect(abrir).toHaveBeenLastCalledWith("https://wa.me/55319?text=x", "_blank", "noopener");
  });

  it("sem permissão de editar: só o PDF; bloqueado: e-mail e WhatsApp desabilitados com o motivo", async () => {
    await montar({ podeEnviar: false });
    expect($("[data-baixar-pdf]")).toBeTruthy();
    expect($("[data-enviar-email-linha]")).toBeNull();
    expect($("[data-enviar-whatsapp-linha]")).toBeNull();
    act(() => root.unmount());
    await montar({ bloqueio: "Orçamento já encerrado, não é possível reenviar" });
    for (const sel of ["[data-enviar-email-linha]", "[data-enviar-whatsapp-linha]"]) {
      const b = $<HTMLButtonElement>(sel)!;
      expect(b.disabled).toBe(true);
      expect(b.title).toBe("Orçamento já encerrado, não é possível reenviar");
    }
    await clicar($("[data-enviar-email-linha]"));
    expect(chamadas).toHaveLength(0);
    act(() => root.unmount());
    await montar();
    expect($<HTMLButtonElement>("[data-enviar-email-linha]")!.title).toBe("Enviar por e-mail — ORC-2026-0147");
  });
});
