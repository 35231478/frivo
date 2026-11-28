// @vitest-environment happy-dom
/**
 * COM-1.2 — as telas da comissão sobre CONTRATO, num DOM de verdade:
 *  - Configurações › Comissões: "Sobre: Contratos" troca as bases (só as do contrato), trava o papel no Vendedor,
 *    mostra o tipo de contrato e a janela de meses (com o texto do que vai valer) e manda tudo no POST; voltar para
 *    serviços volta à base da venda; a regra de contrato aparece na lista com a descrição certa;
 *  - "Renovação também gera": liga a chave e o Salvar manda no PUT;
 *  - o vendedor travado no contrato: a rota do contrato e a dica do histórico.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const roteador = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => roteador, usePathname: () => "/x", useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: vi.fn(async () => null) }) }));
vi.mock("@/components/ui/avisos", async (o) => ({ ...(await o<object>()), toast: vi.fn(), confirmar: vi.fn(async () => true) }));

let raiz: Root | null = null;
let caixa: HTMLDivElement;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
let respostas: Record<string, { status: number; corpo: unknown }> = {};

beforeEach(() => {
  chamadas.length = 0; respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url: String(url), metodo, corpo: init.body ? JSON.parse(String(init.body)) : null });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && String(url).startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  caixa = document.createElement("div"); document.body.appendChild(caixa);
});
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caixa.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
async function montar(el: ReactElement) { raiz = createRoot(caixa); await act(async () => { raiz!.render(el); }); await esperar(); }
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => [...document.querySelectorAll(s)] as T[];
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el, "elemento").toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  expect(el, "campo").toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el, "seletor").toBeTruthy();
  await act(async () => { (el as HTMLSelectElement).value = v; el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
}

const regra = (r: Record<string, unknown>) => ({
  id: "r", quemTipo: "TODOS", usuarioId: null, cargoId: null, papel: "VENDEDOR", sobreTipo: "TODOS_SERVICOS", categoria: null, servicoId: null, base: "PERC_VENDA", valor: 2, ativo: true,
  nomes: { pessoa: null, cargo: null, servico: null }, divisao: "IGUAL", divisaoCargos: null, tipoContrato: null, meses: null, ...r,
});
const DADOS = {
  regras: [
    regra({ id: "r1" }),
    regra({ id: "r2", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 5, meses: 3 }),
    regra({ id: "r3", quemTipo: "PESSOA", usuarioId: "uA", sobreTipo: "CONTRATOS", tipoContrato: "LOCACAO", base: "FIXO_CONTRATO", valor: 250, nomes: { pessoa: "Ana", cargo: null, servico: null } }),
  ],
  config: { quando: "RECEBIMENTO", liquidaImpostos: false, vencimento: { tipo: "DIA_UTIL", dia: 5 }, executorQuando: "CONCLUSAO_OS", retornoDias: 30, tiposRetorno: [], renovacaoGera: false },
  opcoes: { pessoas: [{ id: "uA", nome: "Ana" }], cargos: [{ id: "cg", nome: "Vendedores" }], servicos: [{ id: "s1", nome: "Limpeza" }], categorias: ["Instalação"], tiposOs: [] },
  tetos: [],
};
const abrir = async (dados: any = DADOS) => {
  respostas["GET /api/comissoes"] = { status: 200, corpo: dados }; // o recarregar depois de salvar
  respostas["POST /api/comissoes/regras"] = { status: 201, corpo: { id: "nova" } };
  const { ComissoesClient } = await import("@/components/config/comissoes-client");
  await montar(createElement(ComissoesClient, { inicial: dados }));
};
const opcoesDe = (sel: string) => $$<HTMLOptionElement>(`${sel} option`).map((o) => [o.value, o.textContent, o.disabled]);

describe("Configurações › Comissões: regra sobre contrato", () => {
  it("a lista mostra as regras de contrato com o % e a janela, e o fixo em reais", async () => {
    await abrir();
    expect($$("[data-regra]").map((l) => texto(l.querySelector("p")))).toEqual([
      "Todos · Todos os serviços · 2% da venda",
      "Todos · Todos os contratos · 5% das mensalidades nos 3 primeiros meses",
      "Ana (pessoa) · Contratos de Locação · R$ 250,00 no fechamento",
    ]);
    expect(texto($("[data-regra='r3']"))).toContain("Valor fixo no fechamento: R$ 250,00");
  });

  it("Sobre: Contratos — só as bases do contrato, papel no Vendedor, tipo de contrato e janela de meses (com o texto); o POST leva tudo", async () => {
    await abrir();
    await clicar($("[data-nova-regra]"));
    // Fora de contratos, as bases do contrato nem aparecem
    expect(opcoesDe("[data-campo-base]").map((o) => o[0])).toEqual(["PERC_VENDA", "PERC_LUCRO", "FIXO_ITEM"]);
    expect($("[data-campo-tipo-contrato]")).toBeNull();
    await escolher($("[data-campo-sobre]"), "CONTRATOS");
    expect(opcoesDe("[data-campo-base]").map((o) => o[0])).toEqual(["PERC_MENSALIDADE", "FIXO_CONTRATO"]);
    expect(($("[data-campo-base]") as HTMLSelectElement).value).toBe("PERC_MENSALIDADE");
    expect(opcoesDe("[data-campo-papel]")).toEqual([["VENDEDOR", "Vendedor", false], ["EXECUTOR", "Executor", true], ["RESPONSAVEL", "Responsável (em breve)", true]]);
    expect(opcoesDe("[data-campo-tipo-contrato]").map((o) => o[1])).toEqual(["Todos os contratos", "Manutenção Preventiva", "Manutenção Corretiva", "Manutenção Completa", "Instalação", "Locação", "Assistência Técnica"]);
    expect(($("[data-campo-meses]") as HTMLInputElement).value).toBe("3");
    expect(texto($("[data-form-regra]"))).toContain("A comissão vale nos 3 primeiros meses.");
    expect(texto($("[data-form-regra]"))).toContain("Percentual da mensalidade (%)");
    await digitar($("[data-campo-meses]"), "0");
    expect(texto($("[data-form-regra]"))).toContain("A comissão vale enquanto o contrato estiver ativo.");
    await digitar($("[data-campo-meses]"), "12x");
    expect(($("[data-campo-meses]") as HTMLInputElement).value).toBe("12"); // só dígitos
    await digitar($("[data-campo-meses]"), "200");
    expect(texto($("[data-form-regra]"))).toContain("De 0 a 120.");
    await digitar($("[data-campo-meses]"), "6");
    await escolher($("[data-campo-tipo-contrato]"), "LOCACAO");
    await digitar($("[data-campo-valor]"), "7,5");
    await clicar($("[data-salvar-regra]"));
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/comissoes/regras");
    expect(post?.corpo).toMatchObject({ papel: "VENDEDOR", sobreTipo: "CONTRATOS", base: "PERC_MENSALIDADE", valor: 7.5, tipoContrato: "LOCACAO", meses: 6 });
  });

  it("o fixo no fechamento não tem janela (e o POST não leva meses); voltar para serviços volta à base da venda", async () => {
    await abrir();
    await clicar($("[data-nova-regra]"));
    await escolher($("[data-campo-sobre]"), "CONTRATOS");
    await escolher($("[data-campo-base]"), "FIXO_CONTRATO");
    expect($("[data-campo-meses]")).toBeNull();
    expect(texto($("[data-form-regra]"))).toContain("Valor no fechamento (R$)");
    await digitar($("[data-campo-valor]"), "200");
    await clicar($("[data-salvar-regra]"));
    const post = chamadas.find((c) => c.metodo === "POST" && c.url === "/api/comissoes/regras");
    expect(post?.corpo).toMatchObject({ sobreTipo: "CONTRATOS", base: "FIXO_CONTRATO", valor: 200, tipoContrato: null });
    expect(post?.corpo).not.toHaveProperty("meses");
    // Uma regra nova sobre serviços: a base de contrato não sobra
    await clicar($("[data-nova-regra]"));
    await escolher($("[data-campo-sobre]"), "CONTRATOS");
    await escolher($("[data-campo-sobre]"), "TODOS_SERVICOS");
    expect(($("[data-campo-base]") as HTMLSelectElement).value).toBe("PERC_VENDA");
    expect($("[data-campo-tipo-contrato]")).toBeNull();
  });

  it("editar a regra de contrato traz o tipo e a janela de volta", async () => {
    await abrir();
    await clicar($("[data-regra='r2'] [data-editar-regra]"));
    expect(($("[data-campo-sobre]") as HTMLSelectElement).value).toBe("CONTRATOS");
    expect(($("[data-campo-meses]") as HTMLInputElement).value).toBe("3");
    expect(($("[data-campo-tipo-contrato]") as HTMLSelectElement).value).toBe("");
  });

  it("'Renovação também gera': ligar habilita o Salvar e o PUT manda a chave", async () => {
    await abrir();
    const salvar = $<HTMLButtonElement>("[data-salvar-config-comissao]")!;
    expect(salvar.disabled).toBe(true);
    expect(texto($("[data-config-contrato]"))).toContain("Renovação também gera");
    await clicar($("[data-renovacao-gera] [role='switch']"));
    expect(salvar.disabled).toBe(false);
    await clicar(salvar);
    const put = chamadas.find((c) => c.metodo === "PUT" && c.url === "/api/comissoes");
    expect(put?.corpo).toMatchObject({ renovacaoGera: true });
  });
});

describe("vendedor travado do contrato", () => {
  it("usa a rota do contrato e diz que o motivo fica no histórico do contrato", async () => {
    const { VendedorTravado } = await import("@/components/comissoes/vendedor-travado");
    await montar(createElement(VendedorTravado, {
      url: "/api/contratos/ct1/vendedor", vendedor: { id: "uV", nome: "Vitor Vendas" }, podeTrocar: true,
      opcoes: [{ id: "uV", nome: "Vitor Vendas" }, { id: "uP", nome: "Paula Pessoa" }], dica: "Fica no histórico do contrato.",
    }));
    expect(texto($("[data-vendedor-nome]"))).toBe("Vitor Vendas");
    await clicar($("[data-trocar-vendedor]"));
    expect(texto(document.body)).toContain("Fica no histórico do contrato.");
    await escolher($("[data-novo-vendedor]"), "uP");
    await digitar($("[data-motivo-vendedor]"), "Carteira nova da Paula");
    respostas["PATCH /api/contratos/ct1/vendedor"] = { status: 200, corpo: { vendedor: { id: "uP", nome: "Paula Pessoa" } } };
    await clicar($("[data-confirmar-vendedor]"));
    expect(chamadas.find((c) => c.metodo === "PATCH")).toMatchObject({ url: "/api/contratos/ct1/vendedor", corpo: { vendedorId: "uP", motivo: "Carteira nova da Paula" } });
  });
});
