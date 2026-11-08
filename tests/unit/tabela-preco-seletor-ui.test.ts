// @vitest-environment happy-dom
/**
 * Seletor de itens do orçamento × tabela de preços do cliente (componente real, num DOM de verdade):
 *  - cliente SEM tabela: a busca mostra o catálogo padrão inteiro (serviços E produtos) com o preço padrão,
 *    sem cadeado e sem nenhum item/preço de tabela de outro cliente;
 *  - cliente COM tabela: só os itens da tabela dele, com o preço da tabela; o cadeado abre o catálogo
 *    todo (o que está fora vem com o preço padrão e marcado “Fora da tabela”);
 *  - trocar o cliente: o seletor passa a respeitar a tabela (ou a falta dela) do novo cliente, e o cadeado
 *    volta a fechar;
 *  - tabela inativa: catálogo padrão + aviso.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/orcamentos/novo", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: string[] = [];

/** A tabela do Hospital: só a limpeza (R$ 420) e o capacitor (R$ 45, bloqueado) */
const TABELA_HOSP = {
  id: "t-hosp", nome: "Hospital 2026", tipo: "PADRAO", precosBloqueados: false, vinculadaInativa: null,
  itens: {
    "s-limp": { valorFinal: 420, bloqueado: false, tipoPreco: "VALOR_FIXO", descontoPercent: null },
    "p-cap": { valorFinal: 45, bloqueado: true, tipoPreco: "DESCONTO_PERCENTUAL", descontoPercent: 10 },
  },
};
const BASE = {
  clientes: [
    { id: "c-sem", nome: "Padaria Pão Quente", nomeFantasia: null },
    { id: "c-hosp", nome: "Hospital Santa Clara Ltda", nomeFantasia: "Hospital Santa Clara" },
    { id: "c-velha", nome: "Escola Horizonte", nomeFantasia: null },
  ],
  catalogoServicos: [
    { id: "s-limp", codigo: "LIMP01", nome: "Limpeza de split", descricao: null, unidade: "UN", valorPadrao: 500 },
    { id: "s-inst", codigo: "INST01", nome: "Instalação", descricao: null, unidade: "UN", valorPadrao: 900 },
  ],
  catalogoProdutos: [
    { id: "p-cap", codigo: 1, nome: "Capacitor", descricao: null, unidade: "UN", valorPadrao: 50 },
    { id: "p-gas", codigo: 2, nome: "Gás R410", descricao: null, unidade: "kg", valorPadrao: 300 },
  ],
  tecnicos: [], termoTemplates: [], clienteIdInicial: "c-sem",
};

beforeAll(async () => {
  await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/medicao/medicao-form"), import("@/components/providers/permissoes-provider")]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  respostas = {
    "GET /api/clientes/c-sem/tabela-preco": { status: 200, corpo: null },
    "GET /api/clientes/c-hosp/tabela-preco": { status: 200, corpo: TABELA_HOSP },
    "GET /api/clientes/c-velha/tabela-preco": { status: 200, corpo: { id: null, nome: null, tipo: null, precosBloqueados: false, itens: null, vinculadaInativa: { id: "t-velha", nome: "Tabela 2023" } } },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push(`${metodo} ${url}`);
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

async function montar(props: Record<string, unknown> = {}, qual: "orcamento" | "medicao" = "orcamento") {
  const [{ OrcamentoForm }, { MedicaoForm }, { PermissoesProvider }] = await Promise.all([import("@/components/forms/orcamento-form"), import("@/components/medicao/medicao-form"), import("@/components/providers/permissoes-provider")]);
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  const Form = qual === "medicao" ? MedicaoForm : OrcamentoForm;
  await act(async () => {
    root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(Form as any, { mode: "novo", ...BASE, ...props }) }));
  });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll(sel)] as T[];
const sp = (t: string) => t.replace(/ /g, " ");
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const SERV = "Pesquisar serviço por nome ou código...";
const PROD = "Pesquisar produto por nome ou código...";
/** Abre a busca (o campo pode estar com o placeholder "da tabela") e devolve as opções: "nome → preço" */
const TAB = "Pesquisar na tabela do cliente...";
async function opcoes(grupo: "servico" | "produto") {
  // Os grupos vêm na ordem Serviços, Produtos; com tabela os dois campos têm o placeholder "da tabela"
  const campos = $$<HTMLInputElement>("input").filter((i) => [SERV, PROD, TAB].includes(i.placeholder));
  const campo = campos[grupo === "servico" ? 0 : 1];
  expect(campo, `campo de ${grupo}`).toBeTruthy();
  // Se o campo ainda está focado da chamada anterior, o focus() não dispara evento: tira o foco antes
  await act(async () => { if (document.activeElement === campo) campo!.blur(); });
  await act(async () => { campo!.focus(); campo!.dispatchEvent(new Event("focus", { bubbles: true })); });
  await esperar();
  const lista = campo!.parentElement!.querySelector(".absolute.z-20")!;
  const itens = [...lista.querySelectorAll("button")].filter((b) => !b.textContent?.startsWith("Novo") && !b.textContent?.startsWith("Cadastrar") && !b.textContent?.startsWith("Criar"))
    .map((b) => {
      const nome = [...b.querySelector("p")!.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim(); // sem o código
      return `${nome} → ${sp(b.querySelector("span.font-mono.shrink-0")!.textContent!)}`;
    });
  const vazio = lista.querySelector("p.italic")?.textContent ?? null;
  await act(async () => { document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
  return { itens, vazio, placeholder: campo!.placeholder };
}
const cadeados = () => $$("button").filter((b) => /Mostrar todos os serviços|Mostrar só da tabela/.test(b.textContent ?? ""));
/** O campo de cliente: no orçamento é o SelectCadastroRapido (botão que abre a lista); na medição, um <select> */
const ROTULOS: Record<string, string> = { "c-sem": "Padaria Pão Quente", "c-hosp": "Hospital Santa Clara", "c-velha": "Escola Horizonte" };
async function trocarCliente(id: string) {
  const sel = $$<HTMLSelectElement>("select").find((s) => [...s.options].some((o) => o.value === id));
  if (sel) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, id);
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperar();
    return;
  }
  const gatilho = $$("button").find((b) => Object.values(ROTULOS).some((r) => b.textContent?.trim().startsWith(r)));
  expect(gatilho, "seletor de cliente").toBeTruthy();
  await clicar(gatilho);
  const opcao = $$("button").find((b) => b !== gatilho && b.textContent?.trim().startsWith(ROTULOS[id]));
  expect(opcao, `opção ${id}`).toBeTruthy();
  await clicar(opcao);
}

describe("seletor de itens × tabela de preços do cliente", () => {
  it("cliente SEM tabela: catálogo padrão inteiro (serviços e produtos) com o preço padrão, sem cadeado, nada da tabela de outro cliente", async () => {
    await montar();
    expect(chamadas).toContain("GET /api/clientes/c-sem/tabela-preco");
    expect(document.body.textContent).not.toContain("Tabela:");
    expect(cadeados()).toHaveLength(0);
    const s = await opcoes("servico");
    expect(s.placeholder).toBe(SERV);
    expect(s.itens).toEqual(["Limpeza de split → R$ 500,00", "Instalação → R$ 900,00"]); // 500, não os 420 do Hospital
    const p = await opcoes("produto");
    expect(p.itens).toEqual(["Capacitor → R$ 50,00", "Gás R410 → R$ 300,00"]); // 50, não os 45 do Hospital
  });

  it("cliente COM tabela: só a tabela dele com o preço dela; o cadeado abre o catálogo todo (fora da tabela = preço padrão)", async () => {
    await montar({ clienteIdInicial: "c-hosp" });
    expect(document.body.textContent).toContain("Tabela: Hospital 2026");
    expect(cadeados().map((b) => b.textContent)).toEqual(["Mostrar todos os serviços", "Mostrar todos os serviços"]);
    let s = await opcoes("servico");
    expect([s.placeholder, s.itens]).toEqual(["Pesquisar na tabela do cliente...", ["Limpeza de split → R$ 420,00"]]);
    let p = await opcoes("produto");
    expect(p.itens).toEqual(["Capacitor → R$ 45,00"]);
    // Cadeado dos serviços: abre o catálogo todo; a instalação vem com o preço padrão
    await clicar(cadeados()[0]);
    expect(cadeados()[0].textContent).toBe("Mostrar só da tabela");
    s = await opcoes("servico");
    expect([s.placeholder, s.itens]).toEqual([SERV, ["Limpeza de split → R$ 420,00", "Instalação → R$ 900,00"]]);
    p = await opcoes("produto");
    expect(p.itens).toEqual(["Capacitor → R$ 45,00"]); // o cadeado é por grupo
  });

  it("trocar o cliente: com tabela → sem tabela volta ao catálogo padrão (e o cadeado some); sem → com restringe de novo com o cadeado fechado", async () => {
    await montar({ clienteIdInicial: "c-hosp" });
    await clicar(cadeados()[0]); // abriu o catálogo para o Hospital
    await trocarCliente("c-sem");
    expect(chamadas.filter((c) => c.includes("tabela-preco")).at(-1)).toBe("GET /api/clientes/c-sem/tabela-preco");
    expect(document.body.textContent).not.toContain("Tabela:");
    expect(cadeados()).toHaveLength(0);
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 500,00", "Instalação → R$ 900,00"]);
    expect((await opcoes("produto")).itens).toEqual(["Capacitor → R$ 50,00", "Gás R410 → R$ 300,00"]);
    // De volta ao Hospital: a tabela dele, com o cadeado FECHADO (não herda o "mostrar todos" de antes)
    await trocarCliente("c-hosp");
    expect(document.body.textContent).toContain("Tabela: Hospital 2026");
    expect(cadeados().map((b) => b.textContent)).toEqual(["Mostrar todos os serviços", "Mostrar todos os serviços"]);
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 420,00"]);
  });

  it("cliente com tabela INATIVA: catálogo padrão com o preço padrão + aviso de qual tabela estava ligada", async () => {
    await montar({ clienteIdInicial: "c-velha" });
    expect(document.body.textContent).not.toContain("Tabela:");
    expect($("[data-aviso-tabela-inativa]")!.textContent).toBe("A tabela do cliente (“Tabela 2023”) está inativa: valem os preços padrão do catálogo.");
    expect(cadeados()).toHaveLength(0);
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 500,00", "Instalação → R$ 900,00"]);
    // Trocando para um cliente com tabela ativa, o aviso some e vale a tabela dele
    await trocarCliente("c-hosp");
    expect($("[data-aviso-tabela-inativa]")).toBeNull();
    expect(document.body.textContent).toContain("Tabela: Hospital 2026");
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 420,00"]);
  });

  it("fatura (medição) usa o mesmo seletor: sem tabela = catálogo padrão; inativa = catálogo + aviso; com tabela = só a dela", async () => {
    await montar({}, "medicao");
    expect(document.body.textContent).not.toContain("Tabela:");
    expect(cadeados()).toHaveLength(0);
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 500,00", "Instalação → R$ 900,00"]);
    expect((await opcoes("produto")).itens).toEqual(["Capacitor → R$ 50,00", "Gás R410 → R$ 300,00"]);
    await trocarCliente("c-velha");
    expect($("[data-aviso-tabela-inativa]")!.textContent).toBe("A tabela do cliente (“Tabela 2023”) está inativa: valem os preços padrão do catálogo.");
    expect((await opcoes("servico")).itens).toEqual(["Limpeza de split → R$ 500,00", "Instalação → R$ 900,00"]);
    await trocarCliente("c-hosp");
    expect($("[data-aviso-tabela-inativa]")).toBeNull();
    expect(document.body.textContent).toContain("Tabela: Hospital 2026");
    expect((await opcoes("produto")).itens).toEqual(["Capacitor → R$ 45,00"]);
    // E de volta para quem não tem tabela: a tabela do Hospital não fica presa na fatura
    await trocarCliente("c-sem");
    expect(document.body.textContent).not.toContain("Tabela:");
    expect((await opcoes("produto")).itens).toEqual(["Capacitor → R$ 50,00", "Gás R410 → R$ 300,00"]);
  });
});
