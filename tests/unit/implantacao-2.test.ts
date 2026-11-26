// @vitest-environment happy-dom
/**
 * Implantação, leva 2 — equipamentos: o motor (puro) e a tela de importação (DOM real).
 *  - capacidade ("12000", "36.000 btu", "5 TR", "7,5 tr"; sem unidade abaixo de 1.000 = erro), gás, tensão;
 *  - série/TAG comparadas sem espaços, hífens, pontos e maiúsculas; "parecido" = cliente + unidade + marca +
 *    modelo + capacidade;
 *  - validar: unidade vazia = a principal; unidade que não existe; série repetida (sem id = erro; com id, não é
 *    chave); série de outro cliente; sem chave = aviso + possível duplicado; tipo vazio = aviso;
 *  - entre linhas: duas sem chave e iguais = aviso na 2ª; o resumo conta as linhas com aviso;
 *  - tela: avisos na prévia (filtro "Com aviso"), no resultado e o download "avisos"; a família de clientes só
 *    mostra Equipamentos com o módulo ligado e a permissão de criar equipamento.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { analisar, type ContextoImportacao } from "@/lib/importacao/motor";
import { chaveCodigo, chaveParecido, IMPORTACOES, lerCapacidade, normalizarFluido, normalizarTensao } from "@/lib/importacao/entidades";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/equipamentos", useSearchParams: () => new URLSearchParams() }));

const CNPJ = "11444777000161";
const CNPJ2 = "11222333000181";
const E = IMPORTACOES.equipamentos;
const ctx = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map([["serie:LGX0001", "q1"], ["pat:TAG031", "q2"], ["serie:C2123", "q3"], ["id:q1", "q1"]]),
  refs: { tipo: [{ valor: "c:t-split", rotulo: "Split Hi-Wall (parede)", aceitos: ["split", "hi wall"] }, { valor: "e:PISO_TETO", rotulo: "Piso-Teto", aceitos: ["piso teto"] }, { valor: "e:OUTRO", rotulo: "Outro", aceitos: [] }] },
  podeAtualizar: true,
  mapas: {
    clientes: new Map([[CNPJ, "c1"], [CNPJ2, "c2"]]),
    unidades: new Map([["c1|*principal", "u1p"], ["c1|anexo", "u1a"], ["c1|principal", "u1p"]]),
    equipamentoDoCliente: new Map([["q1", "c1"], ["q2", "c1"], ["q3", "c2"]]),
    ambiguas: new Map([["serie:DUP9", "2"]]),
    parecidos: new Map([[chaveParecido("c1", "u1p", "Midea", "MPT-60", "5 TR"), "Midea MPT-60 5 TR (Auditório), sem série"]]),
  },
  ...o,
});
const COLS = E.colunas.map((c) => c.chave);
const linha = (o: Record<string, string | number | null>) => E.validar(Object.fromEntries(COLS.map((k) => [k, o[k] ?? null])), ctx());

/* ═════════════ Motor ═════════════ */
describe("equipamentos (motor)", () => {
  it("capacidade: BTU e TR em vários jeitos; sem unidade, de 1.000 para cima = BTU; abaixo = erro; texto = erro", () => {
    expect(lerCapacidade("12000")).toEqual({ valor: "12.000 BTU/h" });
    expect(lerCapacidade(12000)).toEqual({ valor: "12.000 BTU/h" });
    expect(lerCapacidade("36.000 btu")).toEqual({ valor: "36.000 BTU/h" });
    expect(lerCapacidade("9.000 BTU/h")).toEqual({ valor: "9.000 BTU/h" });
    expect(lerCapacidade("18000 BTUs")).toEqual({ valor: "18.000 BTU/h" });
    expect(lerCapacidade("5 TR")).toEqual({ valor: "5 TR" });
    expect(lerCapacidade("7,5 tr")).toEqual({ valor: "7,5 TR" });
    expect(lerCapacidade("10 ton")).toEqual({ valor: "10 TR" });
    expect(lerCapacidade("")).toEqual({});
    expect(lerCapacidade(null)).toEqual({});
    expect(lerCapacidade("60").erro).toMatch(/“60” sem unidade/);
    expect(lerCapacidade(60).erro).toMatch(/“60” sem unidade/);
    expect(lerCapacidade("999").erro).toMatch(/sem unidade/);
    expect(lerCapacidade("1000")).toEqual({ valor: "1.000 BTU/h" });
    expect(lerCapacidade("doze mil").erro).toMatch(/não é uma capacidade/);
    expect(lerCapacidade("0 TR").erro).toMatch(/não é uma capacidade/);
  });

  it("gás e tensão: conhecidos ficam no formato do cadastro; o resto fica como veio", () => {
    expect(normalizarFluido("r-410a")).toBe("R410A");
    expect(normalizarFluido("410A")).toBe("R410A");
    expect(normalizarFluido("R134A")).toBe("R134a");
    expect(normalizarFluido(" r 32 ")).toBe("R32");
    expect(normalizarFluido("MO99")).toBe("MO99");
    expect(normalizarFluido(undefined)).toBeUndefined();
    expect(normalizarTensao("220")).toBe("220V");
    expect(normalizarTensao("380 v")).toBe("380V");
    expect(normalizarTensao("220/380")).toBe("220/380");
    expect(normalizarTensao(undefined)).toBeUndefined();
  });

  it("série/TAG sem espaços, hífens, pontos, barras e maiúsculas; parecido sem acento e maiúsculas", () => {
    expect(chaveCodigo("lgx 0001")).toBe("LGX0001");
    expect(chaveCodigo("LGX-0001")).toBe("LGX0001");
    expect(chaveCodigo("a.b/c_d")).toBe("ABCD");
    expect(chaveParecido("c", "u", "MIDEA", "Mpt-60", "5 tr")).toBe(chaveParecido("c", "u", "midea", "MPT-60", "5 TR"));
    expect(chaveParecido("c", "u", "Midea", "MPT-60", null)).not.toBe(chaveParecido("c", "u", "Midea", "MPT-60", "5 TR"));
  });

  it("unidade vazia = a principal; pelo nome (sem acento/maiúsculas); que não existe = erro", () => {
    expect(linha({ cnpj_cpf: CNPJ, marca: "LG", modelo: "S4", numero_serie: "N1" })).toMatchObject({ ok: true, dados: { clienteId: "c1", unidadeId: "u1p" } });
    expect(linha({ cnpj_cpf: CNPJ, unidade: "ANEXO", marca: "LG", modelo: "S4", numero_serie: "N1" })).toMatchObject({ ok: true, dados: { unidadeId: "u1a" } });
    expect(linha({ cnpj_cpf: CNPJ, unidade: "Filial", marca: "LG", modelo: "S4" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/unidade: “Filial” não existe neste cliente/)] });
    // cliente sem principal
    expect(E.validar(Object.fromEntries(COLS.map((k) => [k, ({ cnpj_cpf: CNPJ2, marca: "LG", modelo: "S4" } as any)[k] ?? null])), ctx()))
      .toMatchObject({ ok: false, erros: [expect.stringMatching(/não tem unidade principal/)] });
  });

  it("chaves: id → série → TAG; série repetida sem id = erro; com id, a repetida não é chave; série de outro cliente = erro com o valor digitado", () => {
    expect(linha({ cnpj_cpf: CNPJ, marca: "LG", modelo: "S4", numero_serie: "lgx-0001", patrimonio: "tag 031" })).toMatchObject({ ok: true, chaves: ["serie:LGX0001", "pat:TAG031"] });
    expect(linha({ cnpj_cpf: CNPJ, marca: "X", modelo: "Y", numero_serie: "dup 9" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/numero_serie: “dup 9” já está em 2 equipamentos/)] });
    expect(linha({ cnpj_cpf: CNPJ, marca: "X", modelo: "Y", numero_serie: "dup 9", id_sistema: "q1" })).toMatchObject({ ok: true, chaves: ["id:q1"] });
    expect(linha({ cnpj_cpf: CNPJ, marca: "X", modelo: "Y", numero_serie: "C2-123" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/nº de série “C2-123” é de um equipamento de outro cliente/)] });
    expect(linha({ cnpj_cpf: CNPJ, marca: "X", modelo: "Y", patrimonio: "TAG-031" })).toMatchObject({ ok: true, chaves: ["pat:TAG031"] });
  });

  it("sem chave: aviso + possível duplicado; tipo vazio: aviso; com tipo e chave: sem aviso", () => {
    const r = linha({ cnpj_cpf: CNPJ, marca: "midea", modelo: "mpt-60", capacidade: "5 tr", tipo: "piso teto" }) as any;
    expect(r.ok).toBe(true);
    expect(r.chaves).toEqual([]);
    expect(r.dados).toMatchObject({ semChave: true, tipoRef: "e:PISO_TETO", capacidade: "5 TR" });
    expect(r.avisos).toEqual([
      "Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento.",
      "Possível duplicado — já cadastrado nesta unidade: Midea MPT-60 5 TR (Auditório), sem série.",
    ]);
    expect((linha({ cnpj_cpf: CNPJ, marca: "LG", modelo: "S4", numero_serie: "N9" }) as any).avisos).toEqual(["tipo vazio: se o equipamento for novo, entra como “Outro”."]);
    expect((linha({ cnpj_cpf: CNPJ, marca: "LG", modelo: "S4", numero_serie: "N9", tipo: "split" }) as any).avisos).toEqual([]);
    expect(linha({ cnpj_cpf: CNPJ, marca: "LG", modelo: "S4", tipo: "Nave" })).toMatchObject({ ok: false, erros: [expect.stringMatching(/tipo “Nave” não existe/)] });
  });

  it("entre linhas: duas sem chave e iguais = aviso na 2ª; o resumo conta as linhas com aviso", () => {
    const cab = ["cnpj_cpf", "tipo", "marca", "modelo", "capacidade", "numero_serie"];
    const a = analisar([cab, [CNPJ, "split", "LG", "S4", "9000", ""], [CNPJ, "split", "lg", "s4", "9.000 btu", ""], [CNPJ, "split", "LG", "S4", "9000", "SER-1"], [CNPJ, "split", "LG", "S4", "", ""]], E, ctx());
    expect(a.resumo).toMatchObject({ criar: 4, erros: 0, avisos: 3 });
    expect(a.linhas[1].avisos).toContain("Igual à linha 2 (mesmo cliente, unidade, marca, modelo e capacidade): confira se não é o mesmo equipamento.");
    expect(a.linhas[2].avisos).toBeUndefined();
    expect(a.linhas[3].avisos).toEqual(["Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento."]);
  });
});

/* ═════════════ Tela ═════════════ */
let root: Root | null = null;
let caixa: HTMLDivElement;
let PProv: any, MProv: any, ImportarPlanilha: any;
beforeAll(async () => {
  ({ PermissoesProvider: PProv } = await import("@/components/providers/permissoes-provider"));
  ({ ModulosProvider: MProv } = await import("@/components/providers/modulos-provider"));
  ({ ImportarPlanilha } = await import("@/components/importacao/importar-planilha"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const espera = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function montar(entidade: string, permissoes: Permissoes = permissoesTotais(), desligados: string[] = []) {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(MProv, { desligados }, createElement(PProv, { permissoes, role: "OPERADOR" }, createElement(ImportarPlanilha, { entidade })))); });
  await act(async () => { ($("[data-acao='importar-planilha']") as HTMLButtonElement).click(); });
  await espera();
}
async function clicar(sel: string) { await act(async () => { ($(sel) as HTMLElement).click(); }); await espera(); }
async function escolherArquivo() {
  const input = $("[data-campo='arquivo']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], "eq.csv")], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await espera();
}
function rede(respostas: { status: number; json: unknown }[]) {
  const enviados: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    enviados.push({ url, body: init?.body });
    const r = respostas.shift()!;
    if (url.endsWith("/erros")) return new Response(new Blob(["x"]), { status: 200 });
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  return enviados;
}
const AVISO = "Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento.";
const PREVIA = {
  podeAtualizar: true,
  analise: {
    linhas: [
      { linha: 2, status: "criar", rotulo: "LG S4", erros: [], valores: {}, avisos: [AVISO] },
      { linha: 3, status: "criar", rotulo: "LG S5", erros: [], valores: {} },
      { linha: 4, status: "erro", rotulo: "X", erros: ["unidade: “Filial” não existe neste cliente."], valores: {} },
    ],
    resumo: { total: 3, criar: 2, atualizar: 0, erros: 1, avisos: 1 }, colunasIgnoradas: [], colunas: { cabecalho: [], ligadas: {}, faltando: [] },
  },
};

describe("tela: equipamentos", () => {
  it("prévia mostra os avisos, filtra 'Com aviso' e diz quantas entram com aviso; resultado lista e baixa os avisos", async () => {
    const enviados = rede([
      { status: 200, json: PREVIA },
      { status: 200, json: { ok: true, criados: 2, atualizados: 0, comErro: 1, erros: [PREVIA.analise.linhas[2]], observacoes: [], avisos: [{ linha: 2, rotulo: "LG S4", valores: { marca: "LG" }, avisos: [AVISO] }] } },
      { status: 200, json: {} },
    ]);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    await montar("equipamentos");
    expect($("[data-escolher-planilha]")).toBeNull(); // equipamentos sozinho (a família é a de clientes)
    expect($("[data-acao='baixar-cadastrados']")!.getAttribute("href")).toBe("/api/importacao/equipamentos/exportar");
    await escolherArquivo();
    expect($$("[data-linha-aviso]").map((e) => e.textContent)).toEqual([`• ${AVISO}`]);
    expect($("[data-previa]")!.textContent).toMatch(/1 linha\(s\) entram com aviso para revisar/);
    expect($("[data-aviso-previa]")!.textContent).toMatch(/possíveis duplicados/);
    await clicar("[data-filtro='aviso']");
    expect($$("[data-linha-status]").length).toBe(1);
    await clicar("[data-acao='confirmar-importacao']");
    expect($("[data-avisos-resultado]")!.textContent).toMatch(/1 gravada\(s\) com aviso — revise:.*linha 2 \(LG S4\): Sem nº de série/);
    await clicar("[data-acao='baixar-avisos']");
    const pedido = enviados.find((e) => e.url.endsWith("/erros"))!;
    expect(JSON.parse(String(pedido.body))).toEqual({ tipo: "avisos", erros: [{ linha: 2, erros: [AVISO], valores: { marca: "LG" } }] });
  });

  it("linha com erro não mostra aviso; sem avisos não há filtro nem botão", async () => {
    rede([{ status: 200, json: { ...PREVIA, analise: { ...PREVIA.analise, linhas: [{ ...PREVIA.analise.linhas[2], avisos: ["x"] }], resumo: { total: 1, criar: 0, atualizar: 0, erros: 1, avisos: 0 } } } }]);
    await montar("equipamentos");
    await escolherArquivo();
    expect($$("[data-linha-aviso]")).toHaveLength(0);
    expect($("[data-filtro='aviso']")).toBeNull();
  });

  it("família de clientes: Equipamentos só com o módulo ligado e a permissão de criar equipamento", async () => {
    await montar("clientes");
    expect($$("[data-importar-o-que]").map((b) => b.dataset.importarOQue)).toEqual(["clientes", "unidades", "contatos", "equipamentos"]);
    await clicar("[data-importar-o-que='equipamentos']");
    expect($("[data-importacao]")!.dataset.importacao).toBe("equipamentos");
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";

    await montar("clientes", permissoesTotais(), ["equipamentos"]);
    expect($$("[data-importar-o-que]").map((b) => b.dataset.importarOQue)).toEqual(["clientes", "unidades", "contatos"]);
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";

    await montar("clientes", montarPermissoes({ clientes: ["visualizar", "criar", "editar"], equipamentos: ["visualizar"] }));
    expect($$("[data-importar-o-que]").map((b) => b.dataset.importarOQue)).toEqual(["clientes", "unidades", "contatos"]);
  });
});
