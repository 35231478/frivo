// @vitest-environment happy-dom
/**
 * OS sem equipamento — as telas num DOM de verdade (API simulada):
 *  - atividades da OS: a trava de equipamento oferece "Concluir sem equipamento — justificar" (só para
 *    quem pode concluir OS); motivo obrigatório (mín. 10); envia motivo + atividade; conclui na tela;
 *    outras recusas (checklist incompleto) não oferecem a saída;
 *  - execução desktop: tipo que não exige / recorrente mostram por que dá para concluir sem equipamento;
 *    sem saída, a pendência traz a mensagem e o botão de justificar;
 *  - cadastro de Tipos de OS: "Exige equipamento para concluir" ligado por padrão; desligar grava false;
 *    a lista mostra "Não exige".
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { MSG_SAIDAS_SEM_EQUIPAMENTO, MSG_SEM_EQUIPAMENTO, textoDispensa, verificarConclusao } from "@/lib/execucao/pendencias";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/os1", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown }>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];
const MSG_TRAVA = `${MSG_SEM_EQUIPAMENTO} ${MSG_SAIDAS_SEM_EQUIPAMENTO}`;

beforeAll(async () => {
  await Promise.all([
    import("@/components/os/os-atividades"), import("@/components/os/atividade-execucao"),
    import("@/app/(dashboard)/configuracoes/tipos-os/page"), import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.refresh.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.split(" "); return m === metodo && url.startsWith(u); }).sort((a, b) => b.length - a.length)[0];
    const r = chave ? respostas[chave] : { status: 200, corpo: metodo === "GET" ? [] : {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); });

async function montar(el: any, permissoes: Permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const texto = (sel: string) => ($(sel)?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (t: string) => $$("button").find((b) => b.textContent?.trim() === t);
async function digitar(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperar();
}
async function escolher(el: Element | null, v: string) {
  expect(el).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const sem = (modulo: string, acao: string) => {
  const p = permissoesTotais() as any;
  p[modulo] = { ...p[modulo], [acao]: false };
  return p as Permissoes;
};

const tec = { id: "t1", nome: "João Silva" };
const ATIVIDADE = {
  id: "a1", titulo: "Visita de avaliação", status: "EM_ANDAMENTO", dataAgendada: null, prazo: null, duracaoMin: null, observacao: null, resumo: null,
  tipoOs: null, tipoOsId: null, tecnicoId: "t1", tecnico: tec, equipe: null, tecnicosEquipe: [{ tecnico: tec }], veiculo: null, equipamentos: [], respostas: [],
};
async function montarAtividades(permissoes?: Permissoes) {
  const { OsAtividades } = await import("@/components/os/os-atividades");
  const onMudou = vi.fn();
  await montar(createElement(OsAtividades, { osId: "os1", atividades: [ATIVIDADE], clienteId: "c1", unidadeId: "un1", onMudou }), permissoes);
  return onMudou;
}
async function tentarConcluir() {
  await clicar($$("button").find((b) => b.textContent?.includes("Visita de avaliação")));
  await escolher($$("select").find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === "CONCLUIDA")) ?? null, "CONCLUIDA");
}

describe("atividades da OS: saída justificada da trava de equipamento", () => {
  it("a trava oferece 'Concluir sem equipamento — justificar'; motivo curto não envia; motivo ok conclui na tela", async () => {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 422, corpo: { erro: MSG_TRAVA, semEquipamento: true, pendencias: [] } };
    respostas["POST /api/ordens/os1/concluir-sem-equipamento"] = { status: 200, corpo: { ok: true, status: "CONCLUIDA", semEquipamentoMotivo: "Visita de avaliação do local" } };
    const onMudou = await montarAtividades();
    await tentarConcluir();
    expect(texto("[data-erro-status-atividade]")).toContain(MSG_TRAVA);
    await clicar($("[data-concluir-sem-equipamento]"));
    expect($("[data-modal-sem-equipamento]")).toBeTruthy();

    await digitar($("[data-modal-sem-equipamento] textarea"), "curto");
    await clicar($("[data-confirmar-sem-equipamento]"));
    expect(texto("[data-modal-sem-equipamento] [role='alert']")).toBe("Explique o motivo (pelo menos 10 caracteres).");
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([]);

    await digitar($("[data-modal-sem-equipamento] textarea"), "  Visita de avaliação do local  ");
    await clicar($("[data-confirmar-sem-equipamento]"));
    expect(chamadas.filter((c) => c.metodo === "POST")).toEqual([
      { url: "/api/ordens/os1/concluir-sem-equipamento", metodo: "POST", corpo: { motivo: "Visita de avaliação do local", atividadeId: "a1" } },
    ]);
    expect($("[data-erro-status-atividade]")).toBeNull();
    expect($("[data-modal-sem-equipamento]")).toBeNull();
    expect(caixa.textContent).toContain("Concluída");
    expect(onMudou).toHaveBeenCalled();
  });

  it("erro do servidor fica no modal (nada muda na lista)", async () => {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 422, corpo: { erro: MSG_TRAVA, semEquipamento: true } };
    respostas["POST /api/ordens/os1/concluir-sem-equipamento"] = { status: 422, corpo: { erro: "Para concluir, falta: Split — 1 item sem resposta." } };
    await montarAtividades();
    await tentarConcluir();
    await clicar($("[data-concluir-sem-equipamento]"));
    await digitar($("[data-modal-sem-equipamento] textarea"), "Motivo bem explicado aqui");
    await clicar($("[data-confirmar-sem-equipamento]"));
    expect(texto("[data-modal-sem-equipamento] [role='alert']")).toBe("Para concluir, falta: Split — 1 item sem resposta.");
    expect($("[data-erro-status-atividade]")).toBeTruthy();
  });

  it("sem permissão de concluir OS: a mensagem aparece, o botão de justificar não", async () => {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 422, corpo: { erro: MSG_TRAVA, semEquipamento: true } };
    await montarAtividades(sem("ordens", "concluir"));
    await tentarConcluir();
    expect(texto("[data-erro-status-atividade]")).toContain("justificando o motivo");
    expect($("[data-concluir-sem-equipamento]")).toBeNull();
  });

  it("recusa por checklist incompleto (não é falta de equipamento) não oferece a saída", async () => {
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 422, corpo: { erro: "Para concluir, falta: Split — 1 item sem resposta.", semEquipamento: false, pendencias: [{}] } };
    await montarAtividades();
    await tentarConcluir();
    expect($("[data-erro-status-atividade]")).toBeTruthy();
    expect($("[data-concluir-sem-equipamento]")).toBeNull();
  });
});

describe("execução desktop: por que dá (ou não) para concluir sem equipamento", () => {
  const exec = (dispensaEquipamento: any) => ({
    atividade: { id: "a1", titulo: "Visita", status: "EM_ANDAMENTO", tipoOs: null },
    os: { id: "os1", numero: "OS-2026-0001", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, equipamentos: [], adicionais: [],
    conclusao: verificarConclusao([], dispensaEquipamento), dispensaEquipamento,
  });
  async function montarExec(dispensa: any, permissoes?: Permissoes) {
    respostas["GET /api/ordens/os1/atividades/a1/execucao"] = { status: 200, corpo: exec(dispensa) };
    const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
    await montar(createElement(AtividadeExecucao, { osId: "os1", atividadeId: "a1", titulo: "Visita", osNumero: "OS-2026-0001", tipoOs: null }), permissoes);
  }

  it("tipo que não exige: diz por quê e conclui direto (PUT da atividade)", async () => {
    const dispensa = { motivo: "TIPO", texto: textoDispensa("TIPO", "Visita Técnica") };
    respostas["PUT /api/ordens/os1/atividades/a1"] = { status: 200, corpo: {} };
    await montarExec(dispensa);
    expect($("[data-dispensa-equipamento]")?.getAttribute("data-dispensa-equipamento")).toBe("TIPO");
    expect(texto("[data-resumo-execucao]")).toContain("“Visita Técnica” não exige equipamento");
    expect(texto("[data-sem-equipamentos]")).toContain("não exige equipamento");
    expect(texto("[data-sem-equipamentos]")).not.toContain("é preciso pelo menos 1 equipamento");
    await clicar($("[data-concluir]"));
    expect(chamadas.find((c) => c.metodo === "PUT")).toMatchObject({ url: "/api/ordens/os1/atividades/a1", corpo: { status: "CONCLUIDA" } });
    expect($("[data-pendencias]")).toBeNull();
  });

  it("OS recorrente sem equipamento: mesma coisa, com o texto do contrato", async () => {
    await montarExec({ motivo: "RECORRENTE", texto: textoDispensa("RECORRENTE") });
    expect($("[data-dispensa-equipamento]")?.getAttribute("data-dispensa-equipamento")).toBe("RECORRENTE");
    expect(texto("[data-resumo-execucao]")).toContain("recorrente do contrato");
  });

  it("sem saída: 'Concluir' mostra a trava com as saídas e o botão de justificar, que conclui pela rota da exceção", async () => {
    respostas["POST /api/ordens/os1/concluir-sem-equipamento"] = { status: 200, corpo: { ok: true, status: "CONCLUIDA" } };
    await montarExec(null);
    expect(texto("[data-sem-equipamentos]")).toContain("é preciso pelo menos 1 equipamento");
    await clicar($("[data-concluir]"));
    expect(texto("[data-pendencias]")).toContain(MSG_TRAVA);
    expect(chamadas.some((c) => c.metodo === "PUT")).toBe(false); // a tela já sabe: não chama o servidor
    await clicar($("[data-pendencias] [data-concluir-sem-equipamento]"));
    await digitar($("[data-modal-sem-equipamento] textarea"), "Cliente pediu só avaliação técnica");
    await clicar($("[data-confirmar-sem-equipamento]"));
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({ url: "/api/ordens/os1/concluir-sem-equipamento", corpo: { motivo: "Cliente pediu só avaliação técnica", atividadeId: "a1" } });
    expect(texto("[data-mensagem]")).toBe("Atividade concluída sem equipamento.");
    expect($("[data-pendencias]")).toBeNull();
  });

  it("sem permissão de concluir OS, a trava aparece sem o botão de justificar", async () => {
    await montarExec(null, sem("ordens", "concluir"));
    await clicar($("[data-concluir]"));
    expect($("[data-pendencias]")).toBeTruthy();
    expect($("[data-concluir-sem-equipamento]")).toBeNull();
  });
});

describe("cadastro de Tipos de OS", () => {
  it("'Exige equipamento para concluir' vem ligado; desligar grava false; a lista mostra 'Não exige'", async () => {
    respostas["GET /api/tipos-os"] = { status: 200, corpo: [
      { id: "t1", nome: "Manutenção Preventiva", descricao: null, cor: "#3b82f6", ativo: true, exigeEquipamento: true },
      { id: "t2", nome: "Visita Técnica", descricao: null, cor: "#10b981", ativo: true, exigeEquipamento: false },
    ] };
    respostas["POST /api/tipos-os"] = { status: 201, corpo: { id: "t3", nome: "Vistoria", descricao: "", cor: "#3b82f6", ativo: true, exigeEquipamento: false } };
    const { default: Pagina } = await import("@/app/(dashboard)/configuracoes/tipos-os/page");
    await montar(createElement(Pagina));
    expect($$("[data-exige-equipamento]").map((e) => [e.getAttribute("data-exige-equipamento"), e.textContent])).toEqual([["sim", "Exige para concluir"], ["nao", "Não exige"]]);
    await clicar($$("button").find((b) => /Novo|Adicionar/.test(b.textContent ?? "")) ?? null);
    const chave = () => document.querySelector("[data-campo-switch='exigeEquipamento'] [role='switch']") as HTMLElement;
    expect(chave().getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector("[data-campo-switch='exigeEquipamento']")?.textContent).toContain("visita técnica, vistoria, orçamento");
    await clicar(chave());
    expect(chave().getAttribute("aria-checked")).toBe("false");
    const nome = [...document.querySelectorAll("input")].find((i) => i.placeholder?.startsWith("Ex: Manutenção")) ?? null;
    await digitar(nome, "Vistoria");
    await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Adicionar")!.click(); });
    await esperar();
    expect(chamadas.find((c) => c.metodo === "POST")).toMatchObject({ url: "/api/tipos-os", corpo: { nome: "Vistoria", exigeEquipamento: false } });
    expect($$("[data-exige-equipamento='nao']")).toHaveLength(2);
  });
});
