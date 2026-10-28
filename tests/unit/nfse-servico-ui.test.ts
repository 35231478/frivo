// @vitest-environment happy-dom
/**
 * NFS-e PR2 — cadastro do serviço num DOM de verdade:
 *  - seção "Dados fiscais (NFS-e)" com os 7 campos na ordem, textos de ajuda, busca da LC 116
 *    (datalist com código + descrição, ligada ao campo) e a tributação com o padrão "Tributável";
 *  - quem tem Financeiro › Fiscal (ou é ADMIN) edita; quem não tem vê os dados SÓ PARA LEITURA, com o
 *    aviso uma vez só, e o salvar não manda os campos fiscais (o resto do serviço continua editável);
 *  - criar sem a permissão manda os campos travados com os valores padrão (o servidor aceita).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";
import { LISTA_LC116 } from "@/lib/nfse/lc116";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const SERVICO = {
  id: "s1", codigo: "LIMP01", nome: "Limpeza de split", descricao: null, unidade: "un", valorPadrao: "120", ativo: true,
  codigoLc116: "14.01", codigoMunicipal: null, aliquotaISS: "5", nfseTributacao: null, issRetido: false, cnae: "4322302", discriminacaoPadrao: null,
  aliquotaPIS: null, aliquotaCOFINS: null, aliquotaCSLL: null, aliquotaIR: null, observacaoFiscal: null,
};
const ROTULOS_FISCAIS = [
  "Código do serviço (LC 116)", "Código de tributação municipal", "Alíquota de ISS (%)", "Tributação do ISS",
  "ISS retido pelo tomador", "CNAE (opcional)", "Discriminação padrão (opcional)",
];

let root: Root;
let caixa: HTMLDivElement;
let enviados: { metodo: string; corpo: any }[];
let recusar: string | null;
beforeEach(() => {
  enviados = [];
  recusar = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    if (init?.method === "POST" || init?.method === "PATCH") {
      enviados.push({ metodo: init.method, corpo: JSON.parse(String(init.body)) });
      if (recusar) return new Response(JSON.stringify({ erro: recusar }), { status: 400 });
      return new Response(JSON.stringify({ ...SERVICO, id: "s9" }), { status: 200 });
    }
    const corpo = u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
      : { itens: [SERVICO], total: 1, pagina: 1, porPagina: 50, contagens: { ativos: 1, inativos: 0, todos: 1 } };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
async function abrir(permissoes: Permissoes, o: { role?: string; novo?: boolean } = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: o.role ?? "OPERADOR", permissoes, children: createElement(CadastroPadrao, { entidade: "servicos" }) })); });
  await esperar();
  const botao = o.novo ? document.querySelector('[data-acao="novo-cadastro"]') : document.querySelector('[aria-label="Editar Limpeza de split"]');
  await act(async () => { (botao as HTMLElement).click(); });
  await esperar();
}
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** O controle do campo pelo rótulo (label ligado por htmlFor) */
function campo<T extends HTMLElement = HTMLInputElement>(rotulo: string): T {
  const label = [...document.querySelectorAll("label")].find((l) => texto(l).replace(/\*$/, "") === rotulo);
  expect(label, rotulo).toBeTruthy();
  return document.getElementById(label!.htmlFor) as T;
}
const ajudaDe = (rotulo: string) => texto(campo(rotulo).parentElement!.querySelector("p"));
async function digitar(el: HTMLElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function salvar() {
  const b = [...document.querySelectorAll("button")].find((x) => /^(Salvar|Adicionar)$/.test(texto(x)));
  await act(async () => { b!.click(); });
  await esperar();
}

describe("Seção Dados fiscais (NFS-e) no cadastro do serviço", () => {
  it("campos na ordem, abaixo do título da seção; outros tributos em seção própria", async () => {
    await abrir(GESTOR_FISCAL);
    const titulos = [...document.querySelectorAll("h4")].map(texto);
    expect(titulos).toContain("Dados fiscais (NFS-e)");
    expect(titulos.indexOf("Outros tributos")).toBeGreaterThan(titulos.indexOf("Dados fiscais (NFS-e)"));
    const rotulos = [...document.querySelectorAll("label")].map(texto);
    const i = rotulos.indexOf(ROTULOS_FISCAIS[0]);
    expect(rotulos.slice(i, i + 7)).toEqual(ROTULOS_FISCAIS);
    expect(rotulos[i + 7]).toBe("Alíquota PIS (%)");
  });

  it("busca da LC 116: lista do navegador com código + descrição, ligada ao campo; os textos de ajuda aparecem", async () => {
    await abrir(GESTOR_FISCAL);
    const lc = campo("Código do serviço (LC 116)");
    expect(lc.value).toBe("14.01");
    const lista = document.getElementById(lc.getAttribute("list")!)!;
    expect(lista.tagName).toBe("DATALIST");
    const opcoes = [...lista.querySelectorAll("option")];
    expect(opcoes).toHaveLength(LISTA_LC116.length);
    expect(opcoes.find((o) => o.value === "14.01")!.getAttribute("label")).toMatch(/^14\.01 — Lubrificação, limpeza/);
    expect(document.querySelectorAll("datalist")).toHaveLength(1); // só o LC 116 tem sugestões
    expect(campo("CNAE (opcional)").hasAttribute("list")).toBe(false);
    // a ajuda descreve o código digitado; fora da lista volta o texto fixo
    expect(ajudaDe("Código do serviço (LC 116)")).toMatch(/^14\.01 — Lubrificação, limpeza/);
    await digitar(lc, "1406");
    expect(ajudaDe("Código do serviço (LC 116)")).toMatch(/^14\.06 — Instalação e montagem/);
    await digitar(lc, "17.99");
    expect(ajudaDe("Código do serviço (LC 116)")).toBe("Subitem da lista da LC 116, no formato NN.NN.");
    expect(ajudaDe("Alíquota de ISS (%)")).toBe("Vazio = usa o ISS da empresa (o mesmo dos orçamentos).");
    expect(campo("Código de tributação municipal").placeholder).toBe("Vazio = o próprio código LC 116");
  });

  it("tributação: vazio = Tributável (padrão); retido: Não", async () => {
    await abrir(GESTOR_FISCAL);
    const trib = campo<HTMLSelectElement>("Tributação do ISS");
    expect(trib.value).toBe("");
    expect(texto(trib.selectedOptions[0])).toBe("Tributável no município (padrão)");
    expect([...trib.options].map((o) => o.value)).toEqual(["", "ISENTO", "IMUNE", "NAO_INCIDENCIA", "SUSPENSA_JUDICIAL", "SUSPENSA_ADMINISTRATIVA"]);
    const ret = campo<HTMLSelectElement>("ISS retido pelo tomador");
    expect([ret.value, texto(ret.selectedOptions[0])]).toEqual(["false", "Não"]);
  });

  it("com Financeiro › Fiscal: edita e o salvar manda só o que mudou", async () => {
    await abrir(GESTOR_FISCAL);
    expect(document.querySelector("[data-somente-leitura]")).toBeNull();
    for (const r of ROTULOS_FISCAIS) expect(campo(r).hasAttribute("disabled"), r).toBe(false);
    // CNAE gravado só com dígitos aparece formatado; sem mudar, não é enviado
    expect(campo("CNAE (opcional)").value).toBe("4322-3/02");
    await digitar(campo("Código de tributação municipal"), "140101");
    await digitar(campo<HTMLSelectElement>("ISS retido pelo tomador"), "true");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { codigoMunicipal: "140101", issRetido: "true" } }]);
  });

  it("sem Financeiro › Fiscal: só leitura (aviso uma vez), o resto edita e o salvar não manda dado fiscal", async () => {
    await abrir(GESTOR);
    const avisos = document.querySelectorAll("[data-somente-leitura]");
    expect(avisos).toHaveLength(1);
    expect(texto(avisos[0])).toBe("Somente leitura: alterar estes dados exige a permissão Financeiro › Fiscal (NFS-e).");
    for (const r of ROTULOS_FISCAIS) expect(campo(r).hasAttribute("disabled"), r).toBe(true);
    expect(campo("Código do serviço (LC 116)").value).toBe("14.01"); // continua visível
    for (const r of ["Nome", "Alíquota PIS (%)"]) expect(campo(r).hasAttribute("disabled"), r).toBe(false);
    await digitar(campo("Nome"), "Limpeza de split 9000");
    await salvar();
    expect(enviados).toEqual([{ metodo: "PATCH", corpo: { nome: "Limpeza de split 9000" } }]);
  });

  it("erro do servidor: mostra no topo e rola até ele", async () => {
    const rolou = vi.fn();
    (HTMLElement.prototype as any).scrollIntoView = rolou;
    await abrir(GESTOR_FISCAL);
    recusar = "CNAE (opcional): CNAE inválido: use os 7 dígitos da subclasse (ex.: 4321-5/00).";
    await digitar(campo("CNAE (opcional)"), "43223");
    expect(rolou).not.toHaveBeenCalled();
    await salvar();
    const alerta = document.querySelector('[role="alert"]')!;
    expect(texto(alerta)).toBe(recusar);
    expect(rolou.mock.contexts).toContain(alerta);
    expect(rolou).toHaveBeenCalledWith({ block: "nearest" });
    delete (HTMLElement.prototype as any).scrollIntoView;
  });

  it("ADMIN edita mesmo sem o Fiscal no perfil", async () => {
    await abrir(GESTOR, { role: "ADMIN" });
    expect(document.querySelector("[data-somente-leitura]")).toBeNull();
    expect(campo("CNAE (opcional)").hasAttribute("disabled")).toBe(false);
  });

  it("criar sem o Fiscal: os campos travados vão com os valores padrão (o servidor aceita)", async () => {
    await abrir(GESTOR, { novo: true });
    await digitar(campo("Nome"), "Visita técnica");
    await salvar();
    expect(enviados).toHaveLength(1);
    expect(enviados[0].metodo).toBe("POST");
    expect(enviados[0].corpo).toMatchObject({
      nome: "Visita técnica", codigoLc116: "", codigoMunicipal: "", aliquotaISS: "", nfseTributacao: "", issRetido: "false", cnae: "", discriminacaoPadrao: "",
    });
  });
});
