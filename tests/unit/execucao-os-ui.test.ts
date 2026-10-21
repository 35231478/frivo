// @vitest-environment happy-dom
/**
 * Execução da OS por equipamento — as telas num DOM de verdade (happy-dom), API simulada:
 *  - execução: um cartão por equipamento com o checklist do tipo DELE; cada toque grava SÓ o campo
 *    (OK/Atenção/N-A ou a observação); erro desfaz o toque; "Concluir" mostra exatamente o que falta
 *    (sem chamar o servidor) e, quando pronto, envia; atividade concluída = só leitura; vincular pela lista;
 *  - editor do checklist do tipo: adicionar, remover, reordenar e salvar a lista inteira; sugestão AVAC;
 *    quem só visualiza não edita;
 *  - detalhe da OS: progresso do checklist e fotos por equipamento; remover recusado mostra o motivo;
 *  - nova OS: escolher os equipamentos atendidos da unidade e enviá-los na criação (opcional).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { permissoesTotais, permissoesVazias } from "@/lib/permissoes";
import { completo, faltasEquipamento, paraPendencia, verificarConclusao } from "@/lib/execucao/pendencias";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh, replace: () => {}, back: () => {} }),
  usePathname: () => "/ordens/nova", useSearchParams: () => new URLSearchParams(),
}));

let root: Root;
let caixa: HTMLDivElement;
let respostas: Record<string, { status: number; corpo: unknown } | ((url: string, init: RequestInit) => { status: number; corpo: unknown })>;
const chamadas: { url: string; metodo: string; corpo: any }[] = [];

beforeAll(async () => {
  await Promise.all([
    import("@/components/os/atividade-execucao"), import("@/components/cadastros/editores/checklist-tipo"),
    import("@/components/os/atividade-equipamentos"), import("@/app/(dashboard)/ordens/nova/page"), import("@/components/providers/permissoes-provider"),
  ]);
}, 120_000);

beforeEach(() => {
  chamadas.length = 0;
  nav.push.mockClear();
  respostas = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    const metodo = String(init.method ?? "GET");
    chamadas.push({ url, metodo, corpo });
    const chave = Object.keys(respostas).filter((k) => { const [m, u] = k.includes(" ") ? k.split(" ") : ["GET", k]; return m === metodo && url.startsWith(u); })
      .sort((a, b) => b.length - a.length)[0];
    const r0 = chave ? respostas[chave] : { status: 200, corpo: {} };
    const r = typeof r0 === "function" ? r0(url, init) : r0;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { "Content-Type": "application/json" } });
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { act(() => root.unmount()); caixa.remove(); vi.unstubAllGlobals(); });

async function montar(el: any, permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: el })); });
  await esperar();
}
const esperar = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)];
const txt = (sel: string) => ($(sel)?.textContent ?? "").replace(/ /g, " ");
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function sair(el: Element | null) { await act(async () => { (el as HTMLElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await esperar(); }
async function escolher(el: Element | null, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, v);
    el!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const escritas = () => chamadas.filter((c) => c.metodo !== "GET");

/* ───────── Dados da execução (como o GET .../execucao devolve) ───────── */
const ITENS = [
  { id: "i1", texto: "Limpeza dos filtros", pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 0 },
  { id: "i2", texto: "Medição de corrente", pedirFoto: false, pedirObservacao: true, ativo: true, ordem: 1 },
];
const TIPO = { id: "te1", nome: "Split Hi-Wall (parede)" };
const eqTela = (id: string, titulo: string, extra: Record<string, unknown> = {}) => {
  const e: any = {
    vinculoId: `v-${id}`, feito: false, observacao: null,
    equipamento: { id, titulo, descricao: titulo, fabricante: "Daikin FTXS", tag: null, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: TIPO },
    itens: ITENS, respostas: {}, fotos: [], formulario: null, ...extra,
  };
  e.faltas = faltasEquipamento(paraPendencia(e));
  e.completo = completo(e.faltas);
  return e;
};
const execucao = (equipamentos: any[], extra: Record<string, unknown> = {}) => ({
  atividade: { id: "a1", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null },
  os: { id: "os1", numero: "OS-2026-0001", status: "EM_ANDAMENTO", clienteId: "c1", unidadeId: "un1" },
  bloqueada: false, equipamentos, conclusao: verificarConclusao(equipamentos.map((e) => paraPendencia(e))), ...extra,
});
const BASE = "/api/ordens/os1/atividades/a1";

async function montarExecucao() {
  const { AtividadeExecucao } = await import("@/components/os/atividade-execucao");
  await montar(createElement(AtividadeExecucao, { osId: "os1", atividadeId: "a1", titulo: "Preventiva", osNumero: "OS-2026-0001", tipoOs: null }));
}
const card = (id: string) => $(`[data-equipamento-card="${id}"]`)!;
const botaoResposta = (id: string, item: string, s: string) => card(id).querySelector(`[data-item="${item}"] [data-resposta="${s}"]`);

describe("tela de execução", () => {
  it("um cartão por equipamento, com o checklist do tipo dele; abre o 1º que tem o que fazer", async () => {
    const eqA = eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null }, i2: { status: "OK", observacao: "6 A" } } });
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqA, eqTela("eqB", "Split Sala 2")]) };
    await montarExecucao();
    expect($$("[data-equipamento-card]").map((c) => c.getAttribute("data-equipamento-card"))).toEqual(["eqA", "eqB"]);
    expect(card("eqA").getAttribute("data-situacao")).toBe("completo");
    expect(card("eqB").getAttribute("data-situacao")).toBe("nao-iniciado");
    expect(card("eqA").querySelector("[data-item]")).toBeNull(); // fechado: já está completo
    expect([...card("eqB").querySelectorAll("[data-item]")].map((i) => i.textContent)).toEqual([expect.stringContaining("Limpeza dos filtros"), expect.stringContaining("Medição de corrente")]);
    expect(txt("[data-resumo-execucao]")).toContain("1 de 2 equipamentos atendido");
  });

  it("tocar OK grava SÓ o status daquele item daquele equipamento; a observação grava SÓ a observação", async () => {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqTela("eqA", "Split Sala 1"), eqTela("eqB", "Split Sala 2")]) };
    respostas[`PUT ${BASE}/execucao/equipamentos/eqA/itens/i2`] = (_u, init) => ({ status: 200, corpo: { itemId: "i2", status: "ATENCAO", observacao: null, feito: true, ...JSON.parse(String(init.body)) } });
    respostas[`PUT ${BASE}/execucao/equipamentos/eqA/itens/i1`] = { status: 200, corpo: { itemId: "i1", status: "OK", observacao: null, feito: true } };
    await montarExecucao();
    await clicar(botaoResposta("eqA", "i1", "OK"));
    expect(escritas()).toEqual([{ url: `${BASE}/execucao/equipamentos/eqA/itens/i1`, metodo: "PUT", corpo: { status: "OK" } }]);
    expect(botaoResposta("eqA", "i1", "OK")!.getAttribute("aria-pressed")).toBe("true");
    expect(card("eqA").getAttribute("data-situacao")).toBe("pendente"); // atendido, falta o i2
    expect(txt("[data-equipamento-card=\"eqA\"] [data-progresso]")).toBe("1 de 2 itens respondidos");

    await clicar(botaoResposta("eqA", "i2", "ATENCAO"));
    const obs = card("eqA").querySelector('[data-obs-item="i2"]');
    await digitar(obs, "6,2 A");
    await sair(obs);
    expect(escritas().slice(1)).toEqual([
      { url: `${BASE}/execucao/equipamentos/eqA/itens/i2`, metodo: "PUT", corpo: { status: "ATENCAO" } },
      { url: `${BASE}/execucao/equipamentos/eqA/itens/i2`, metodo: "PUT", corpo: { observacao: "6,2 A" } },
    ]);
    // Etapa 2: "Atenção" também pede FOTO do item — ainda falta
    expect(card("eqA").getAttribute("data-situacao")).toBe("pendente");
    expect(txt("[data-equipamento-card=\"eqA\"] [data-faltas]")).toContain("foto em “Medição de corrente”");
    expect(escritas().some((c) => c.url.includes("/eqB/"))).toBe(false); // o outro do mesmo tipo não é tocado
  });

  it("se o servidor recusa, o toque é desfeito e a mensagem aparece (nada fica marcado sem ter gravado)", async () => {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqTela("eqA", "Split Sala 1")]) };
    respostas[`PUT ${BASE}/execucao/equipamentos/eqA/itens/i1`] = { status: 409, corpo: { erro: "Atividade concluída: reabra a atividade para alterar a execução." } };
    await montarExecucao();
    await clicar(botaoResposta("eqA", "i1", "OK"));
    expect(botaoResposta("eqA", "i1", "OK")!.getAttribute("aria-pressed")).toBe("false");
    expect(txt("[data-mensagem]")).toContain("reabra a atividade");
    expect(card("eqA").getAttribute("data-situacao")).toBe("nao-iniciado");
  });

  it("Concluir com pendência: mostra QUAL equipamento e QUAIS itens, sem chamar o servidor", async () => {
    const eqA = eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null } } });
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqA]) };
    await montarExecucao();
    await clicar($("[data-concluir]"));
    expect(txt("[data-pendencias]")).toContain("Split Sala 1 (Sala): 1 item sem resposta (“Medição de corrente”).");
    expect(escritas()).toEqual([]);
    // Respondeu o que faltava: o aviso some sozinho (não fica um "ainda não dá" velho na tela)
    respostas[`PUT ${BASE}/execucao/equipamentos/eqA/itens/i2`] = { status: 200, corpo: { itemId: "i2", status: "NAO_SE_APLICA", observacao: null, feito: true } };
    await clicar(botaoResposta("eqA", "i2", "NAO_SE_APLICA"));
    expect($("[data-pendencias]")).toBeNull();
    expect(txt("[data-resumo-execucao]")).toContain("pronto para concluir");
  });

  it("sem equipamento atendido: diz como resolver; Concluir não envia", async () => {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([]) };
    await montarExecucao();
    expect(txt("[data-sem-equipamentos]")).toContain("Leia o QR Code do equipamento ou escolha na lista da unidade");
    await clicar($("[data-concluir]"));
    expect(txt("[data-pendencias]")).toContain("vincule pelo menos 1 equipamento atendido");
    expect(escritas()).toEqual([]);
  });

  it("tudo respondido: Concluir envia; se o servidor ainda recusar (422), mostra a mensagem dele", async () => {
    const pronto = eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null }, i2: { status: "NAO_SE_APLICA", observacao: null } } });
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([pronto, eqTela("eqB", "Split Sala 2")]) };
    respostas[`PUT ${BASE}`] = { status: 422, corpo: { erro: "Para concluir, falta: formulário “PMOC”." } };
    await montarExecucao();
    await clicar($("[data-concluir]"));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("1 equipamento vinculado não foi atendido"));
    expect(escritas()).toEqual([{ url: BASE, metodo: "PUT", corpo: { status: "CONCLUIDA" } }]);
    expect(txt("[data-pendencias]")).toContain("Para concluir, falta: formulário “PMOC”.");
  });

  it("atividade concluída: só leitura (aviso, respostas travadas, sem Concluir e sem vincular)", async () => {
    const eqA = eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null } } });
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqA], { bloqueada: true, atividade: { id: "a1", titulo: "Preventiva", status: "CONCLUIDA", tipoOs: null } }) };
    await montarExecucao();
    expect(txt("[data-somente-leitura]")).toContain("nada do que foi respondido se perde");
    expect((botaoResposta("eqA", "i2", "OK") as HTMLButtonElement).disabled).toBe(true);
    expect((card("eqA").querySelector("[data-obs-equipamento]") as HTMLTextAreaElement).disabled).toBe(true);
    expect([$("[data-concluir]"), $("[data-ler-qr]"), $("[data-escolher-lista]")]).toEqual([null, null, null]);
  });

  it("vincular pela lista da unidade: mostra só os que ainda não estão na atividade e envia os marcados", async () => {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqTela("eqA", "Split Sala 1")]) };
    respostas["/api/equipamentos"] = { status: 200, corpo: [
      { id: "eqA", nome: "Split Sala 1", marca: "Daikin", modelo: "FTXS", ativo: true },
      { id: "eqB", nome: "Split Sala 2", marca: "Daikin", modelo: "FTXS", ativo: true, tipoEquipamento: TIPO, patrimonio: "AC-02" },
    ] };
    respostas[`POST ${BASE}/equipamentos`] = { status: 201, corpo: [] };
    await montarExecucao();
    await clicar($("[data-escolher-lista]"));
    expect(chamadas.find((c) => c.url.startsWith("/api/equipamentos"))!.url).toBe("/api/equipamentos?unidadeId=un1");
    expect($$("[data-opcao-equipamento]").map((o) => o.getAttribute("data-opcao-equipamento"))).toEqual(["eqB"]);
    expect(txt('[data-opcao-equipamento="eqB"]')).toContain("TAG AC-02");
    await clicar($('[data-opcao-equipamento="eqB"] input'));
    await clicar($("[data-vincular]"));
    expect(escritas()).toEqual([{ url: `${BASE}/equipamentos`, metodo: "POST", corpo: { equipamentoIds: ["eqB"] } }]);
    expect($("[data-lista-equipamentos]")).toBeNull();
  });
});

/* ───────── Editor do checklist do tipo ───────── */
async function montarChecklist(itens: any[], podeEditar = true) {
  respostas["/api/tipos-equipamento/te1/checklist"] = { status: 200, corpo: { tipo: TIPO, itens, sugestao: [
    { texto: "Limpeza dos filtros", pedirFoto: true, pedirObservacao: false }, { texto: "Teste de funcionamento", pedirFoto: false, pedirObservacao: false },
  ] } };
  respostas["PUT /api/tipos-equipamento/te1/checklist"] = (_u, init) => ({ status: 200, corpo: { itens: JSON.parse(String(init.body)).itens.map((i: any, n: number) => ({ id: i.id ?? `novo${n}`, ...i })) } });
  const { ChecklistTipo } = await import("@/components/cadastros/editores/checklist-tipo");
  await montar(createElement(ChecklistTipo, { tipoId: "te1", podeEditar }));
}
const textosItens = () => $$("[data-item-checklist] input[name^='item-']").map((i) => (i as HTMLInputElement).value);
const corpoSalvo = () => escritas().at(-1)!.corpo;

describe("editor do checklist do tipo", () => {
  const ATUAIS = [{ id: "i1", texto: "Limpeza dos filtros", pedirFoto: true, pedirObservacao: false, respostas: 4 }, { id: "i2", texto: "Medição de corrente", pedirFoto: false, pedirObservacao: true }];

  it("reordenar, remover, acrescentar e salvar: manda a lista inteira na ordem, com os ids dos que ficaram", async () => {
    await montarChecklist(ATUAIS);
    expect(textosItens()).toEqual(["Limpeza dos filtros", "Medição de corrente"]);
    expect(txt('[data-item-checklist="1"]')).toContain("já respondido em 4 atendimentos");
    await clicar($('[aria-label="Descer item 1"]'));
    expect(textosItens()).toEqual(["Medição de corrente", "Limpeza dos filtros"]);
    await clicar($("[data-adicionar-item]"));
    await digitar($('input[name="item-3"]'), "Verificação do dreno e bandeja");
    await clicar($('input[name="obs-3"]'));
    await clicar($('[aria-label="Remover item 2"]'));
    await clicar($("[data-salvar-checklist]"));
    expect(corpoSalvo()).toEqual({ itens: [
      { id: "i2", texto: "Medição de corrente", tipoResposta: "OK_ATENCAO_NA", pedirFoto: false, pedirObservacao: true },
      { texto: "Verificação do dreno e bandeja", tipoResposta: "OK_ATENCAO_NA", pedirFoto: false, pedirObservacao: true },
    ] });
    expect(txt('[role="status"]')).toContain("Checklist salvo");
  });

  it("item sem texto não salva (diz qual)", async () => {
    await montarChecklist(ATUAIS);
    await clicar($("[data-adicionar-item]"));
    await clicar($("[data-salvar-checklist]"));
    expect(txt('[role="alert"]')).toBe("Item 3: escreva o texto do item.");
    expect(escritas()).toEqual([]);
  });

  it("tipo sem checklist: “Usar checklist sugerido” preenche os itens de boas práticas", async () => {
    await montarChecklist([]);
    expect($("[data-checklist-vazio]")).not.toBeNull();
    await clicar($("[data-usar-sugestao]"));
    expect(textosItens()).toEqual(["Limpeza dos filtros", "Teste de funcionamento"]);
    expect(($('input[name="foto-1"]') as HTMLInputElement).checked).toBe(true);
  });

  it("quem só visualiza: tudo travado, sem salvar/adicionar/remover", async () => {
    await montarChecklist(ATUAIS, false);
    expect(($('input[name="item-1"]') as HTMLInputElement).disabled).toBe(true);
    expect([$("[data-salvar-checklist]"), $("[data-adicionar-item]"), $('[aria-label="Remover item 1"]')]).toEqual([null, null, null]);
  });
});

/* ───────── Detalhe da OS ───────── */
describe("detalhe da OS: equipamentos atendidos", () => {
  async function montarDetalhe(equipamentos: any[]) {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao(equipamentos) };
    const { AtividadeEquipamentos } = await import("@/components/os/atividade-equipamentos");
    await montar(createElement(AtividadeEquipamentos, { osId: "os1", atividadeId: "a1", clienteId: "c1", unidadeId: "un1" }));
  }

  it("sem equipamento: avisa que abre, mas só conclui com 1 atendido e o checklist dele", async () => {
    await montarDetalhe([]);
    expect(txt("[data-sem-equipamento]")).toContain("só é concluída com pelo menos 1 equipamento atendido e o checklist dele respondido");
  });

  it("cada equipamento com a situação, o progresso do checklist, as fotos e o que falta", async () => {
    await montarDetalhe([
      eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null } }, fotos: [{ id: "f1", itemId: "i1", criadoEm: "2026-10-20" }] }),
      eqTela("eqB", "Cassete", { itens: [], equipamento: { ...eqTela("eqB", "Cassete").equipamento, tipo: { id: "te2", nome: "Cassete" } } }),
    ]);
    const a = $('[data-equipamento-vinculado="eqA"]')!;
    expect(a.getAttribute("data-situacao")).toBe("pendente");
    expect(a.querySelector("[data-progresso-checklist]")!.textContent).toContain("Checklist 1/2");
    expect(a.textContent).toContain("1 foto");
    expect(a.querySelector("[data-faltas]")!.textContent).toBe("Falta: 1 item sem resposta (“Medição de corrente”)");
    expect($('[data-equipamento-vinculado="eqB"] [data-sem-checklist]')!.textContent).toBe("Tipo sem checklist cadastrado");
  });

  it("remover com execução gravada: o servidor recusa e o motivo aparece; o equipamento continua", async () => {
    await montarDetalhe([eqTela("eqA", "Split Sala 1", { feito: true, respostas: { i1: { status: "OK", observacao: null } } })]);
    respostas[`DELETE ${BASE}/equipamentos/v-eqA`] = { status: 409, corpo: { erro: "Este equipamento já tem checklist, fotos ou formulário nesta atividade: para não perder o que foi feito, marque-o como “não atendido” na execução em vez de remover." } };
    await clicar($('[aria-label="Tirar Split Sala 1 da atividade"]'));
    expect(txt("[data-erro-equipamentos]")).toContain("marque-o como “não atendido”");
    expect($('[data-equipamento-vinculado="eqA"]')).not.toBeNull();
  });

  it("sem permissão de editar a OS: não adiciona nem remove", async () => {
    respostas[`${BASE}/execucao`] = { status: 200, corpo: execucao([eqTela("eqA", "Split Sala 1")]) };
    const { AtividadeEquipamentos } = await import("@/components/os/atividade-equipamentos");
    const p = permissoesVazias() as any; p.ordens = { visualizar: true };
    await montar(createElement(AtividadeEquipamentos, { osId: "os1", atividadeId: "a1", clienteId: "c1", unidadeId: "un1" }), p);
    expect([$("[data-adicionar-equipamento]"), $('[aria-label="Tirar Split Sala 1 da atividade"]')]).toEqual([null, null]);
  });
});

/* ───────── Nova OS ───────── */
describe("nova OS: equipamentos atendidos (opcional)", () => {
  it("lista os da unidade; os marcados vão no corpo da criação (na 1ª atividade)", async () => {
    window.history.replaceState(null, "", "/ordens/nova?clienteId=c1&unidadeId=un1&descricao=Preventiva%20mensal");
    respostas["/api/clientes"] = { status: 200, corpo: [{ id: "c1", nome: "Hospital Santa Luzia" }] };
    respostas["/api/unidades"] = { status: 200, corpo: [{ id: "un1", nome: "Matriz" }, { id: "un2", nome: "Anexo" }] };
    respostas["/api/equipamentos"] = { status: 200, corpo: [
      { id: "eqA", nome: "Split Sala 1", marca: "Daikin", modelo: "FTXS", ativo: true, tipoEquipamento: TIPO },
      { id: "eqB", nome: "Split Sala 2", marca: "Daikin", modelo: "FTXS", ativo: true, tipoEquipamento: TIPO },
    ] };
    respostas["/api/contratos"] = { status: 200, corpo: [] };
    respostas["/api/tecnicos"] = { status: 200, corpo: [{ id: "t1", nome: "João Silva", competencias: [] }] };
    respostas["/api/equipes"] = { status: 200, corpo: [{ id: "eq1", nome: "Alfa", liderId: "t1", membroIds: ["t1"] }] };
    respostas["POST /api/ordens"] = { status: 201, corpo: { id: "osNova" } };
    const { default: NovaOrdemPage } = await import("@/app/(dashboard)/ordens/nova/page");
    await montar(createElement(NovaOrdemPage));

    expect(txt("[data-hint-equipamentos]")).toContain("Opcional agora");
    expect(chamadas.find((c) => c.url.startsWith("/api/equipamentos"))!.url).toBe("/api/equipamentos?unidadeId=un1");
    expect($$("[data-opcao-equipamento]").map((o) => o.getAttribute("data-opcao-equipamento"))).toEqual(["eqA", "eqB"]);
    await clicar($('[data-opcao-equipamento="eqB"] input'));
    expect(txt("[data-qtd-atendidos]")).toBe("1 equipamento selecionado");

    await escolher($('select[aria-label="Usar equipe"]'), "eq1");
    await clicar([...caixa.querySelectorAll("button")].find((b) => b.textContent?.includes("Abrir ordem de serviço"))!);
    const post = escritas().find((c) => c.url === "/api/ordens")!;
    expect(post.corpo).toMatchObject({ clienteId: "c1", unidadeId: "un1", equipamentoIds: ["eqB"], execucao: { equipeId: "eq1", tecnicoIds: ["t1"] } });
    expect(nav.push).toHaveBeenCalledWith("/ordens/osNova");
  });
});

/* ───────── Relatório: bloco do equipamento atendido ───────── */
describe("relatório: bloco de cada equipamento atendido", () => {
  it("checklist do tipo com a situação de cada item, resumo, observação do técnico e as fotos DELE", async () => {
    const { BlocosEquipamentos } = await import("@/components/relatorio/relatorio-os-documento");
    const bloco = {
      id: "eqA", local: { principal: "Sala 1", complemento: "1º andar", unidade: "Matriz" }, titulo: "Split Sala 1", descricao: "Split Hi-Wall", fabricante: "Daikin FTXS",
      tag: "AC-01", numeroSerie: null, checklist: [], observacoes: ["Dreno parcialmente obstruído — limpo."],
      checklistTipo: [{ atividade: "Preventiva", itens: [
        { texto: "Limpeza dos filtros", status: "OK" as const, observacao: null, medicao: null, audio: false },
        { texto: "Medição de corrente", status: "ATENCAO" as const, observacao: "6,2 A — acima do nominal", medicao: null, audio: false },
        { texto: "Bomba de dreno", status: "NAO_SE_APLICA" as const, observacao: null, medicao: null, audio: false },
      ] }],
      resumoChecklist: { ok: 1, atencao: 1, naoSeAplica: 1, medicoes: 0 },
      fotos: [{ url: "data:image/png;base64,AAAA", legenda: "Limpeza dos filtros" }],
    };
    await montar(createElement(BlocosEquipamentos, { blocos: [bloco] }));
    expect(txt("[data-equipamentos-relatorio] p")).toBe("Equipamentos atendidos (1)");
    expect($$("[data-item-relatorio]").map((li) => [li.getAttribute("data-status"), li.textContent])).toEqual([
      ["OK", "Limpeza dos filtrosOK"],
      ["ATENCAO", "Medição de correnteAtenção6,2 A — acima do nominal"],
      ["NAO_SE_APLICA", "Bomba de drenoNão se aplica"],
    ]);
    expect(txt("[data-resumo-checklist]")).toBe("1 OK1 Atenção1 Não se aplica");
    expect(txt("[data-observacao-equipamento]")).toContain("Dreno parcialmente obstruído — limpo.");
    expect($$("[data-fotos] img").map((i) => i.getAttribute("alt"))).toEqual(["Limpeza dos filtros"]);
    await act(async () => { root.render(createElement(BlocosEquipamentos, { blocos: [] })); });
    expect($("[data-equipamentos-relatorio]")).toBeNull(); // nenhum atendido = seção some
  });
});
