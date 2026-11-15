// @vitest-environment happy-dom
/**
 * A tela de orçamento não escolhe mais TIPO DE DOCUMENTO.
 *
 * O que isto garante:
 *  - o bloco "Tipo de documento" (Orçamento × Proposta de Contrato) não existe mais na tela, e nem
 *    o estado que o alimentava (nada de botão, cartão ou `setTipo` sobrando);
 *  - o orçamento novo nasce COMUM, no Comercial e dentro da OS;
 *  - o que JÁ é proposta de contrato continua abrindo e salvando como proposta — a tela não converte
 *    nada em silêncio (a proposta será redefinida depois, e os registros que existem ficam de pé).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = path.resolve(__dirname, "../..");
const FORM = "components/forms/orcamento-form.tsx";
const src = readFileSync(path.join(RAIZ, FORM), "utf8");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/novo",
  useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

const BASE = {
  clientes: [{ id: "c1", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" }],
  catalogoServicos: [{ id: "s1", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 500 }],
  catalogoProdutos: [{ id: "p1", nome: "Capacitor 35uF", descricao: null, unidade: "UN", valorPadrao: 50 }],
  tecnicos: [], termoTemplates: [], clienteIdInicial: "c1",
};

/** Uma proposta de contrato que já está gravada (não dá para criar uma pela tela). */
const PROPOSTA_GRAVADA = {
  id: "op1", nome: "Proposta do Hospital", clienteId: "c1", tipo: "PROPOSTA_CONTRATO" as const,
  descontoServicos: 0, tipoDescontoServicos: "VALOR" as const, descontoProdutos: 0, tipoDescontoProdutos: "VALOR" as const,
  issAliquota: 0, servicos: [], produtos: [], ordensServicoIds: [], normas: [],
  proposta: { responsavelTecnicoId: null, artNumero: null, valorMensal: "900" },
};

beforeAll(async () => {
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const corpo = metodo === "GET" ? (String(url).includes("tabela-preco") ? null : []) : { id: "o1" };
    return new Response(JSON.stringify(corpo), { status: metodo === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];

async function montar(props: Record<string, unknown> = {}) {
  const [{ OrcamentoForm }, { PermissoesProvider }] = await Promise.all([
    import("@/components/forms/orcamento-form"),
    import("@/components/providers/permissoes-provider"),
  ]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(PermissoesProvider, {
      role: "OPERADOR", permissoes: permissoesTotais(),
      children: createElement(OrcamentoForm as any, { mode: "novo", ...BASE, ...props }),
    }));
  });
  await esperar();
}

const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null | undefined, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
/** O formulário só envia com item: um serviço do catálogo basta. */
async function comUmItem() {
  await digitar($("input[placeholder='Pesquisar serviço por nome ou código...']"), "Limpe");
  await clicar($$("button").find((b) => b.textContent?.includes("Limpeza de split")));
}
async function enviar() {
  await act(async () => { $("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await esperar();
  const envio = chamadas.find((c) => c.metodo === "POST" || c.metodo === "PUT");
  expect(envio, `nenhum envio; erro na tela: ${$("[data-erro-global]")?.textContent ?? "(nenhum)"}`).toBeTruthy();
  return envio!.corpo;
}

describe("a tela não escolhe tipo de documento", () => {
  it("o bloco e o estado da escolha saíram da fonte", () => {
    expect(src).not.toContain("Tipo de documento");
    expect(src).not.toContain("tiposPermitidos");
    expect(src).not.toContain("setTipo");
    expect(src).not.toContain("LABELS_TIPO_ORCAMENTO");
    // o tipo passa a vir do registro: novo é COMUM, proposta gravada continua proposta
    expect(src).toMatch(/const tipo: TipoOrcamento = embutido \? "COMUM" : inicial\?\.tipo \?\? "COMUM";/);
  });

  it("no Comercial: nenhum cartão de escolha na tela", async () => {
    await montar();
    expect(document.body.textContent).not.toContain("Tipo de documento");
    expect(document.body.textContent).not.toContain("Proposta de Contrato");
    expect($$("button").filter((b) => /Proposta comercial avulsa|Contrato de manutenção/.test(b.textContent ?? ""))).toEqual([]);
  });

  it("o orçamento novo nasce COMUM", async () => {
    await montar();
    await comUmItem();
    expect((await enviar()).tipo).toBe("COMUM");
  });

  it("dentro da OS também não aparece nada de tipo", async () => {
    await montar({ embutido: { osId: "os1", onSalvo: () => {}, onCancelar: () => {} }, osInicialId: "os1" });
    expect(document.body.textContent).not.toMatch(/Tipo de documento|Proposta de Contrato/);
  });
});

describe("a proposta que já existe não é convertida em silêncio", () => {
  it("abrir uma proposta gravada mantém o tipo no que vai para o servidor", async () => {
    await montar({ mode: "editar", inicial: PROPOSTA_GRAVADA });
    await comUmItem();
    const corpo = await enviar();
    expect(corpo.tipo).toBe("PROPOSTA_CONTRATO");
  });

  it("e continua sendo a tela da proposta (sem os blocos do orçamento comum)", async () => {
    await montar({ mode: "editar", inicial: PROPOSTA_GRAVADA });
    expect($("[data-condicoes-comerciais]")).toBeNull();
    expect($("[data-destinatario]")).toBeNull();
  });
});
