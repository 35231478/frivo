// @vitest-environment happy-dom
/**
 * Custo na OS — "Itens da OS" num DOM de verdade:
 *  - com permissão de ver custo: o painel de materiais mostra o custo de cada material e o "Custo interno";
 *  - SEM a permissão (o padrão): nem custo por material nem "Custo interno" — no item que veio do orçamento (só leitura),
 *    nos "Materiais e peças deste item" e ao adicionar um serviço do catálogo; o salvar não manda valor de custo.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { escolherNaBusca } from "../util/busca-select";
import { permissoesTotais } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/ui/avisos", async (original) => ({ ...(await original<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let root: Root;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const M = (produtoId: string, descricao: string, comportamento: string, custoUnit?: number | null) => ({
  produtoId, descricao, unidade: "un", comportamento, quantidade: 2, quantidadePadrao: 2, valorVendaUnit: 20, origem: "SOLTO", kitNome: null,
  ...(custoUnit !== undefined && { custoUnit }),
});
const ITEM_DO_ORCAMENTO = (comCusto: boolean) => ({
  id: "i1", tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", quantidade: 1, valorUnitario: 800, valorTotal: 800, valorBase: 800, ajusteMateriais: 0,
  executado: false, orcamentoServicoId: "os-serv-1", materiais: [M("tubo", "Tubo de cobre", "INCLUSO_NO_SERVICO", comCusto ? 12 : undefined), M("suporte", "Suporte", "INCLUSO_NO_SERVICO", comCusto ? null : undefined)],
});
const ITEM_DIRETO = (comCusto: boolean) => ({ ...ITEM_DO_ORCAMENTO(comCusto), id: "i2", orcamentoServicoId: null, descricao: "Limpeza direta" });

beforeAll(async () => { await Promise.all([import("@/components/os/os-orcamento"), import("@/components/providers/permissoes-provider")]); }, 120_000);
beforeEach(() => {
  chamadas.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url, metodo, corpo });
    const u = new URL(url, "http://localhost");
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/api/cadastros/servicos") return json([{ id: "sInst", nome: "Instalação split", ativo: true }]);
    if (u.pathname === "/api/cadastros/produtos") return json([]);
    // como o servidor responde a quem NÃO vê custo: materiais sem a chave custoUnit
    if (u.pathname === "/api/ordens/os1/orcamento/catalogo") return json({ tipo: "SERVICO", servicoId: "sInst", descricao: "Instalação split", unidade: "un", valorUnitario: 800, origemPreco: "padrao", materiais: [M("tubo", "Tubo de cobre", "INCLUSO_NO_SERVICO"), M("filtro", "Filtro", "INCLUSO_NO_SERVICO")] });
    if (u.pathname === "/api/ordens/os1/orcamento" && metodo === "POST") return json({ id: "novo", ...corpo, executado: false, valorTotal: 800, materiais: corpo.materiais, pecas: [] }, 201);
    return json({ erro: "não mapeado" }, 404);
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const texto = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function montar(itens: unknown[], verCusto?: boolean) {
  const { OsOrcamento } = await import("@/components/os/os-orcamento");
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  const props: Record<string, unknown> = { osId: "os1", itens, clienteId: "c1" };
  if (verCusto !== undefined) props.verCusto = verCusto;
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes: permissoesTotais(), children: createElement(OsOrcamento as any, props) })); });
  await esperar(); await esperar();
}
async function abrirMateriaisDoItem(descricao: string) {
  await clicar($(`button[aria-label='Editar ${descricao}']`));
  const botao = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Materiais e peças deste item"));
  await clicar(botao);
}

describe("Itens da OS — custo só com permissão", () => {
  it("com permissão: item do orçamento (só leitura) mostra custo por material e o Custo interno", async () => {
    await montar([ITEM_DO_ORCAMENTO(true)], true);
    expect($$("[data-custo-material]").map((e) => (e.textContent ?? "").replace(/\s+/g, " "))).toEqual(["custo R$ 24,00", "sem custo"]);
    expect($("[data-custo-interno]")).toBeTruthy();
  });

  it("SEM permissão (padrão): item do orçamento sem nenhum custo", async () => {
    await montar([ITEM_DO_ORCAMENTO(false)]);
    expect($("[data-materiais-linha]")).toBeTruthy();
    expect($("[data-custo-material]")).toBeNull();
    expect($("[data-custo-interno]")).toBeNull();
    expect(texto()).not.toMatch(/Custo interno|custo R\$|sem custo/);
  });

  it("SEM permissão: 'Materiais e peças deste item' (edição) sem custo; com permissão, com custo", async () => {
    await montar([ITEM_DIRETO(false)], false);
    await abrirMateriaisDoItem("Limpeza direta");
    expect($("[data-materiais-linha]")).toBeTruthy();
    expect($("[data-custo-material]")).toBeNull();
    expect($("[data-custo-interno]")).toBeNull();
    act(() => root.unmount()); caixa.remove();
    await montar([ITEM_DIRETO(true)], true);
    await abrirMateriaisDoItem("Limpeza direta");
    expect($("[data-custo-interno]")).toBeTruthy();
  });

  it("SEM permissão: novo serviço do catálogo sem custo; o POST não leva valor de custo", async () => {
    await montar([], false);
    await clicar($('[data-acao="novo-servico"]'));
    await escolherNaBusca($("[name='servicoId']")!, "sInst"); await esperar();
    expect($("[data-materiais-linha]")!.getAttribute("data-total-materiais")).toBe("2");
    expect(texto()).not.toMatch(/Custo interno|custo R\$|sem custo/);
    await clicar($('[data-acao="salvar-item"]'));
    const post = chamadas.find((c) => c.metodo === "POST");
    expect(post).toBeTruthy();
    expect(post!.corpo.materiais.map((m: any) => m.custoUnit ?? null)).toEqual([null, null]);
    expect(JSON.stringify(post!.corpo)).not.toMatch(/"custoUnit":\d/);
  });
});
