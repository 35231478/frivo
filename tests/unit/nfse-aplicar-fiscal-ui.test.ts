// @vitest-environment happy-dom
/**
 * NFS-e — "Aplicar dados fiscais (NFS-e)" em massa na tela real de Serviços (DOM de verdade):
 *  - o botão aparece na barra só com Financeiro › Fiscal E Configurações › Gerenciar (ADMIN sempre);
 *  - o modal abre com todos os campos em "Não alterar": sem nada preenchido não confirma;
 *  - só o que foi preenchido vai no corpo (`dados`), em cada parte do lote; CNAE com três escolhas;
 *  - "copiar de um serviço modelo" preenche tudo e dá para ajustar antes de aplicar;
 *  - resultado "N aplicados · M não puderam" com o motivo de cada um e "já estavam assim";
 *  - dentro da gaveta (Configurações): barra e modal vão para o painel dela e o Esc fecha só o modal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, type Permissoes } from "@/lib/permissoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const GESTOR = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] });
const GESTOR_FISCAL = montarPermissoes({ configuracoes: ["visualizar", "gerenciar"], financeiro: ["visualizar", "fiscal"] });
const SO_FISCAL = montarPermissoes({ configuracoes: ["visualizar"], financeiro: ["visualizar", "fiscal"] });
const BASE = {
  codigo: "X", descricao: null, unidade: "un", valorPadrao: "120", ativo: true,
  codigoMunicipal: null, aliquotaISS: null, nfseTributacao: null, issRetido: false, discriminacaoPadrao: null, cnae: null, codigoLc116: null,
  aliquotaPIS: null, aliquotaCOFINS: null, aliquotaCSLL: null, aliquotaIR: null, observacaoFiscal: null,
};
const SERVICOS = [
  { ...BASE, id: "s1", codigo: "HIG", nome: "Higienização", codigoLc116: "14.01", codigoMunicipal: "140101" },
  { ...BASE, id: "s2", codigo: "INS", nome: "Instalação", codigoLc116: "14.06", codigoMunicipal: "140601", cnae: "4321500", nfseTributacao: "ISENTO", aliquotaISS: "2.5", issRetido: true, discriminacaoPadrao: "Instalação de split" },
  { ...BASE, id: "s3", codigo: "REC", nome: "Recarga de gás" },
];

let root: Root;
let caixa: HTMLDivElement;
let lotes: any[];
let resposta: (corpo: any) => { status: number; json: any };
beforeEach(() => {
  lotes = [];
  resposta = (corpo) => ({ status: 200, json: {
    resultados: corpo.ids.map((id: string) => ({ id, rotulo: SERVICOS.find((s) => s.id === id)?.nome ?? id, ok: true, detalhe: "Atualizado: Código do serviço (LC 116)" })),
    resumo: { total: corpo.ids.length, feitas: corpo.ids.length, naoPuderam: 0 },
  } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname === "/api/acoes-massa") {
      const corpo = JSON.parse(String(init!.body));
      lotes.push(corpo);
      const r = resposta(corpo);
      return new Response(JSON.stringify(r.json), { status: r.status });
    }
    const corpo = u.pathname === "/api/fiscal/apoio-servico" ? { cnaeEmpresa: "4322302", issEmpresa: 3.5, servicos: SERVICOS.map((s) => ({ codigoMunicipal: s.codigoMunicipal, nome: s.nome })) }
      : u.searchParams.get("ativo") === "todos" ? SERVICOS
        : u.searchParams.get("sugestoes") === "1" ? { sugestoes: [] }
          : { itens: SERVICOS, total: 3, pagina: 1, porPagina: 50, contagens: { ativos: 3, inativos: 0, todos: 3 } };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });

const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const texto = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
async function clicar(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); }
async function digitar(el: HTMLElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await esperar();
}
const tecla = (alvo: EventTarget, key: string) => act(async () => { alvo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

async function montar(permissoes: Permissoes, o: { role?: string; gaveta?: boolean } = {}) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  const { TelaServicos } = await import("@/components/config/telas/servicos");
  const { Drawer } = await import("@/components/ui/drawer");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  // Como em Configurações: a lista dentro de uma gaveta
  function NaGaveta() {
    const [aberto, setAberto] = useState(true);
    return createElement("div", null,
      createElement("p", { "data-gaveta-fechada": !aberto || undefined }),
      createElement(Drawer, { aberto, onFechar: () => setAberto(false), titulo: "Serviços", children: createElement(TelaServicos) }));
  }
  const tela = o.gaveta ? createElement(NaGaveta) : createElement(TelaServicos);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: o.role ?? "OPERADOR", permissoes, children: tela })); });
  await esperar();
}
const selecionar = async (...nomes: string[]) => { for (const n of nomes) await clicar(document.querySelector(`input[aria-label="Selecionar ${n}"]`)); };
const botaoAplicar = () => document.querySelector('[data-acao-massa="aplicar-fiscal"]') as HTMLButtonElement | null;
const modal = () => document.querySelector("[data-modal-massa]") as HTMLElement | null;
const confirmar = () => document.querySelector('[data-acao="confirmar-massa"]') as HTMLButtonElement;
const totalCampos = () => texto(document.querySelector("[data-total-campos]"));
function campo<T extends HTMLElement = HTMLInputElement>(rotulo: string): T {
  const label = [...modal()!.querySelectorAll("label")].find((l) => texto(l) === rotulo);
  expect(label, rotulo).toBeTruthy();
  return document.getElementById(label!.htmlFor) as T;
}
const cnaeProprio = () => document.querySelector('input[aria-label="CNAE próprio"]') as HTMLInputElement | null;
async function abrirModal(...nomes: string[]) {
  await selecionar(...(nomes.length ? nomes : ["Higienização", "Recarga de gás"]));
  await clicar(botaoAplicar());
  expect(modal()?.getAttribute("data-modal-massa")).toBe("confirmar");
}

describe("quem vê a ação", () => {
  it("com Financeiro › Fiscal e Configurações › Gerenciar: o botão aparece ao selecionar", async () => {
    await montar(GESTOR_FISCAL);
    expect(botaoAplicar()).toBeNull(); // sem seleção, sem barra
    await selecionar("Higienização");
    expect(texto(botaoAplicar())).toBe("Aplicar dados fiscais (NFS-e)");
  });

  it("sem o Fiscal (só gerencia o cadastro): só inativar; ADMIN vê", async () => {
    await montar(GESTOR);
    await selecionar("Higienização");
    expect(botaoAplicar()).toBeNull();
    expect(document.querySelector('[data-acao-massa="inativar"]')).toBeTruthy();
    act(() => root.unmount()); caixa.remove();
    await montar({}, { role: "ADMIN" });
    await selecionar("Higienização");
    expect(botaoAplicar()).toBeTruthy();
  });

  it("com o Fiscal mas sem gerenciar o cadastro: não aparece", async () => {
    await montar(SO_FISCAL);
    expect(document.querySelector('input[aria-label="Selecionar Higienização"]')).toBeNull();
    expect(botaoAplicar()).toBeNull();
  });
});

describe("o formulário do modal", () => {
  it("abre com tudo em 'Não alterar' e não confirma sem nada preenchido", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    expect(texto(modal()!.querySelector("h3"))).toBe("Aplicar dados fiscais (NFS-e) 2 serviços");
    expect(modal()!.querySelector(".relative.bg-white")!.className).toContain("sm:max-w-2xl");
    expect(texto(modal())).toContain("Campo vazio não muda nada.");
    expect([...modal()!.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"))).toEqual(["Classificação do serviço", "Tributação", "Discriminação"]);
    expect(campo("Código do serviço (LC 116)").placeholder).toBe("Não alterar");
    expect(campo("Alíquota de ISS (%)").placeholder).toBe("Não alterar");
    expect(campo<HTMLSelectElement>("CNAE").value).toBe("manter");
    expect(campo<HTMLSelectElement>("Tributação do ISS").value).toBe("");
    expect(campo<HTMLSelectElement>("ISS retido pelo tomador").value).toBe("");
    expect(totalCampos()).toBe("Preencha ao menos um campo. Campo vazio não muda nada.");
    expect(confirmar().disabled).toBe(true);
    expect(texto(confirmar())).toBe("Aplicar dados fiscais (NFS-e) 2");
  });

  it("preencher conta os campos; só eles vão no corpo, em cada parte; resultado 'N aplicados'", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    await digitar(campo("Código do serviço (LC 116)"), "14.01");
    expect(totalCampos()).toBe("1 campo será aplicado. Os outros ficam como estão em cada serviço.");
    expect(confirmar().disabled).toBe(false);
    await digitar(campo("Alíquota de ISS (%)"), "2,5");
    await digitar(campo<HTMLSelectElement>("ISS retido pelo tomador"), "true");
    expect(totalCampos()).toBe("3 campos serão aplicados. Os outros ficam como estão em cada serviço.");
    // Apagar volta a "não alterar"
    await digitar(campo("Alíquota de ISS (%)"), "  ");
    expect(totalCampos()).toMatch(/^2 campos/);
    await clicar(confirmar());
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toMatchObject({ entidade: "servicos", acao: "aplicar-fiscal", ids: ["s1", "s3"], dados: { codigoLc116: "14.01", issRetido: "true" } });
    expect(Object.keys(lotes[0].dados)).toEqual(["codigoLc116", "issRetido"]);
    const res = document.querySelector("[data-resultado-massa]")!;
    expect(texto(res)).toContain("2 aplicados");
    expect(texto(res)).toContain("0 não puderam");
  });

  it("CNAE: 'usar o da empresa' mostra o CNAE dela e manda null; 'próprio' abre o campo", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    const sel = campo<HTMLSelectElement>("CNAE");
    expect([...sel.options].map((o) => o.text)).toEqual(["Não alterar", "Usar o CNAE principal da empresa (4322-3/02)", "CNAE próprio…"]);
    expect(cnaeProprio()).toBeNull();
    await digitar(sel, "proprio");
    expect(cnaeProprio()).toBeTruthy();
    expect(totalCampos()).toMatch(/^Preencha/); // próprio vazio não conta
    await digitar(cnaeProprio()!, "4321-5/00");
    expect(totalCampos()).toMatch(/^1 campo/);
    await digitar(sel, "empresa");
    expect(cnaeProprio()).toBeNull();
    await clicar(confirmar());
    expect(lotes[0].dados).toEqual({ cnae: null });
  });

  it("copiar de um serviço modelo: preenche tudo (ajustável) e avisa de onde veio", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    const modelo = modal()!.querySelector('[data-seletor-cadastro="servicos"]') as HTMLSelectElement;
    expect([...modelo.options].map((o) => o.text)).toEqual(["Escolha um serviço…", "HIG · Higienização", "INS · Instalação", "REC · Recarga de gás"]);
    expect([...modelo.options].some((o) => o.hasAttribute("data-criar"))).toBe(false); // sem "+ Novo serviço"
    await digitar(modelo, "s2");
    expect(texto(modal())).toContain("Copiado de “Instalação”: revise e ajuste antes de aplicar.");
    expect(campo("Código do serviço (LC 116)").value).toBe("14.06");
    expect(campo("Código municipal").value).toBe("140601");
    expect(campo<HTMLSelectElement>("CNAE").value).toBe("proprio");
    expect(cnaeProprio()!.value).toBe("4321-5/00");
    expect(campo<HTMLSelectElement>("Tributação do ISS").value).toBe("ISENTO");
    expect(campo("Alíquota de ISS (%)").value).toBe("2,5");
    expect(campo<HTMLSelectElement>("ISS retido pelo tomador").value).toBe("true");
    expect(campo<HTMLTextAreaElement>("Discriminação padrão").value).toBe("Instalação de split");
    expect(totalCampos()).toMatch(/^7 campos/);
    // Ajusta antes de aplicar: não muda a discriminação
    await digitar(campo<HTMLTextAreaElement>("Discriminação padrão"), "");
    await clicar(confirmar());
    expect(lotes[0].dados).toEqual({ codigoLc116: "14.06", codigoMunicipal: "140601", cnae: "4321-5/00", nfseTributacao: "ISENTO", aliquotaISS: "2,5", issRetido: "true" });
  });

  it("modelo sem CNAE próprio = usar o da empresa; trocar de modelo sobrescreve; limpar mantém o que está", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    const modelo = modal()!.querySelector('[data-seletor-cadastro="servicos"]') as HTMLSelectElement;
    await digitar(modelo, "s2");
    await digitar(modelo, "s1");
    expect(campo("Código do serviço (LC 116)").value).toBe("14.01");
    expect(campo<HTMLSelectElement>("CNAE").value).toBe("empresa");
    expect(campo<HTMLSelectElement>("Tributação do ISS").value).toBe("TRIBUTAVEL");
    expect(campo<HTMLSelectElement>("ISS retido pelo tomador").value).toBe("false");
    expect(campo("Alíquota de ISS (%)").value).toBe("");
    expect(texto(modal())).toContain("Copiado de “Higienização”");
    await digitar(modelo, "");
    expect(texto(modal())).not.toContain("Copiado de");
    expect(campo("Código do serviço (LC 116)").value).toBe("14.01");
  });

  it("busca nos códigos: municipal sugere os já usados pela empresa", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal();
    const mun = campo("Código municipal");
    await act(async () => { mun.focus(); mun.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await digitar(mun, "1406");
    const op = [...document.querySelectorAll('[role="option"]')].find((o) => o.getAttribute("data-codigo") === "140601")!;
    expect(texto(op)).toContain("Em uso: Instalação");
    await act(async () => { op.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(mun.value).toBe("140601");
  });
});

describe("resultado parcial e erros", () => {
  it("'N aplicados · M não puderam' com o motivo de cada um; os que já estavam assim são contados", async () => {
    resposta = (corpo) => ({ status: 200, json: { resultados: [
      { id: "s1", rotulo: "Higienização", ok: true, detalhe: "Já estava assim" },
      { id: "s2", rotulo: "Instalação", ok: true, detalhe: "Atualizado: CNAE" },
      { id: "s3", rotulo: "Recarga de gás", ok: false, codigo: "sem_permissao", motivo: "Sem permissão para alterar: CNAE." },
    ], resumo: { total: corpo.ids.length, feitas: 2, naoPuderam: 1 } } });
    await montar(GESTOR_FISCAL);
    await abrirModal("Higienização", "Instalação", "Recarga de gás");
    await digitar(campo<HTMLSelectElement>("CNAE"), "empresa");
    await clicar(confirmar());
    const res = document.querySelector("[data-resultado-massa]")!;
    expect(texto(res)).toContain("2 aplicados");
    expect(texto(res)).toContain("1 não pôde");
    expect(texto(res)).toContain("1 já estava assim (conta como aplicado; nada mudou).");
    expect(texto(res)).toContain("Recarga de gás");
    expect(texto(res)).toContain("Sem permissão para alterar: CNAE.");
  });

  it("400 da rota (ex.: alíquota inválida): todos 'não puderam' com a mensagem", async () => {
    resposta = () => ({ status: 400, json: { erro: "Alíquota de ISS (%): no máximo 100." } });
    await montar(GESTOR_FISCAL);
    await abrirModal();
    await digitar(campo("Alíquota de ISS (%)"), "150");
    await clicar(confirmar());
    const res = document.querySelector("[data-resultado-massa]")!;
    expect(texto(res)).toContain("0 aplicados");
    expect(texto(res)).toContain("2 não puderam");
    expect(texto(res)).toContain("Alíquota de ISS (%): no máximo 100.");
  });

  it("vários já estavam assim: plural", async () => {
    resposta = (corpo) => ({ status: 200, json: {
      resultados: corpo.ids.map((id: string) => ({ id, rotulo: id, ok: true, detalhe: "Já estava assim" })),
      resumo: { total: corpo.ids.length, feitas: corpo.ids.length, naoPuderam: 0 },
    } });
    await montar(GESTOR_FISCAL);
    await abrirModal();
    await digitar(campo("Código do serviço (LC 116)"), "14.01");
    await clicar(confirmar());
    expect(texto(document.querySelector("[data-resultado-massa]"))).toContain("2 já estavam assim (contam como aplicados; nada mudou).");
  });

  it("um aplicado: singular", async () => {
    await montar(GESTOR_FISCAL);
    await abrirModal("Higienização");
    await digitar(campo("Código do serviço (LC 116)"), "14.01");
    await clicar(confirmar());
    expect(texto(document.querySelector("[data-resultado-massa]"))).toContain("1 aplicado ");
  });
});

describe("dentro da gaveta de Configurações", () => {
  it("barra e modal vão para o painel da gaveta; Esc fecha só o modal (a gaveta fica)", async () => {
    await montar(GESTOR_FISCAL, { gaveta: true });
    const painel = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(painel).toBeTruthy();
    await selecionar("Higienização");
    expect(painel.contains(document.querySelector("[data-barra-massa]"))).toBe(true);
    await clicar(botaoAplicar());
    expect(painel.contains(modal())).toBe(true);
    await tecla(document, "Escape");
    await esperar();
    expect(modal()).toBeNull();
    expect(document.querySelector("[data-gaveta-fechada]")).toBeNull();
    // Sem o modal, o Esc volta a fechar a gaveta
    await tecla(document, "Escape");
    await esperar();
    expect(document.querySelector("[data-gaveta-fechada]")).toBeTruthy();
  });

  it("com outra camada por cima do modal, o Esc é dela (o modal fica)", async () => {
    const { abrirCamada, fecharCamada } = await import("@/components/ui/camadas");
    await montar(GESTOR_FISCAL, { gaveta: true });
    await abrirModal("Higienização");
    const acima = abrirCamada();
    await tecla(document, "Escape");
    await esperar();
    expect(modal()).toBeTruthy();
    fecharCamada(acima);
    await tecla(document, "Escape");
    await esperar();
    expect(modal()).toBeNull();
    expect(document.querySelector("[data-gaveta-fechada]")).toBeNull();
  });

  it("Esc na lista aberta do código fecha só a lista (o modal fica)", async () => {
    await montar(GESTOR_FISCAL, { gaveta: true });
    await abrirModal("Higienização");
    const lc = campo("Código do serviço (LC 116)");
    await act(async () => { lc.focus(); lc.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    await digitar(lc, "1401");
    expect(document.querySelector('[role="listbox"]')).toBeTruthy();
    await tecla(lc, "Escape");
    await esperar();
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(modal()).toBeTruthy();
    expect(lc.value).toBe("1401");
  });
});
