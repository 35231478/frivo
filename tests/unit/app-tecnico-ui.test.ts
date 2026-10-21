// @vitest-environment happy-dom
/**
 * App do TÉCNICO — as telas num DOM de verdade (happy-dom), com o banco do aparelho de verdade
 * (IndexedDB via fake-indexeddb) e o motor de sincronização real contra um "servidor" simulado:
 *  - Meu dia: cartões na ordem do horário (cliente, endereço, rota no mapa, horário, situação, nº de
 *    equipamentos); sem sinal mostra o que ficou guardado;
 *  - execução guiada: TUDO OK marca só os sem resposta; "Atenção" só salva com foto + observação;
 *    medição só aceita número (vírgula vale) e grava número + unidade; concluir equipamento leva ao
 *    próximo; serviço extra entra na MESMA OS; concluir mostra o que falta (trava da Etapa 1);
 *  - SEM SINAL: tudo isso fica na fila do aparelho (nada é enviado) e o indicador diz "Offline";
 *    o sinal volta → sobe tudo e o indicador fica "Sincronizado";
 *  - regras puras: quem é técnico puro, para onde o middleware leva, cartão (endereço/rota/hora).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PRESETS, montarPermissoes, permissoesTotais } from "@/lib/permissoes";
import { destinoModoTecnico, ehTecnicoPuro, emModoTecnico } from "@/lib/tecnico/modo";
import { enderecoEmLinha, horaMarcada, linkRota, ordenarDoDia } from "@/lib/tecnico/cartao";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

vi.mock("@/lib/imagem-cliente", () => ({
  FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
  reduzirImagem: vi.fn(async () => ({ imagem: { dataUrl: "data:image/jpeg;base64,/9j/FOTO", largura: 10, altura: 10, bytes: 9 }, qualidade: {} })),
}));
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));

/* ───────── dados ───────── */
const item = (id: string, texto: string, extra: Record<string, unknown> = {}) =>
  ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null, ...extra });
const ITENS = [item("i1", "Limpeza dos filtros", { pedirFoto: true }), item("i2", "Dreno e bandeja"), item("m1", "Pressão de sucção", { tipoResposta: "MEDICAO", unidade: "psi" })];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin FTXS", tag: id === "eqA" ? "AC-01" : null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } });
const cartao = (atividadeId: string, hora: string | null, cliente: string, extra: Record<string, unknown> = {}) => ({
  atividadeId, osId: `os-${atividadeId}`, osNumero: `OS-${atividadeId}`, titulo: "Preventiva", tipoOs: { nome: "Preventiva", cor: "#0EA5E9" }, status: "AGENDADA", prioridade: "NORMAL",
  dataAgendada: "2026-10-20T11:30:00.000Z", dia: "2026-10-20", hora, duracaoMin: 60, cliente, telefone: "1133334444", unidade: "Matriz",
  endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6", descricao: "Preventiva mensal",
  equipamentos: 2, atendidos: 0, adicionais: 0, ...extra,
});
function retrato(atividadeId = "aA"): RetratoAtividade {
  return {
    cartao: cartao(atividadeId, "08:30", "Hospital Santa Luzia"),
    execucao: {
      atividade: { id: atividadeId, titulo: "Preventiva", status: "AGENDADA", tipoOs: null },
      os: { id: `os-${atividadeId}`, numero: `OS-${atividadeId}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false,
      equipamentos: [
        { vinculoId: "v1", feito: false, observacao: null, equipamento: info("eqA", "Split Sala 1"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
        { vinculoId: "v2", feito: false, observacao: null, equipamento: info("eqB", "Split Sala 2"), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false },
      ],
      adicionais: [],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 2, mensagem: null },
    },
    equipamentosUnidade: [{ ...info("eqN", "Split Sala 3"), tipoEquipamentoId: "te1", qr: null }],
    checklistsPorTipo: { te1: ITENS },
    geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}

/* ───────── servidor simulado + aparelho ───────── */
let online = true;
let enviadas: { tipo: string; dados?: any; valor?: unknown; equipamentoIds?: string[]; itemId?: string }[] = [];
const meuDia = { tecnico: { id: "t1", nome: "João Silva" }, dia: "2026-10-20", atividades: [cartao("aB", "08:30", "Padaria Pão Quente"), cartao("aA", "14:00", "Hospital Santa Luzia"), cartao("aG", null, "Escola Viva")], anteriores: [] };
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/meu-dia") return json(meuDia);
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const { operacoes } = JSON.parse(String(init!.body));
    enviadas.push(...operacoes);
    return json({ resultados: operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root;
let caixa: HTMLDivElement;
let banco: BancoTecnico;
let motor: MotorSync;

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/indicador-sync")]);
}, 120_000);

beforeEach(async () => {
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; fetchFalso.mockClear();
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online });
  window.history.replaceState(null, "", "/tecnico");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove();
  root = undefined as unknown as Root; caixa = undefined as unknown as HTMLDivElement;
  banco.fechar();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
async function montar(filho: any) {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { IndicadorSync } = await import("@/components/tecnico/indicador-sync");
  const { useTecnico } = await import("@/components/tecnico/contexto");
  function Topo() { const { estado } = useTecnico(); return createElement(IndicadorSync, { estado }); }
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, motorPronto: motor, children: [createElement(Topo, { key: "t" }), createElement("div", { key: "c" }, filho)] })); });
  await esperar();
}
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 80; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => caixa.querySelector(sel) as T | null;
const $$ = (sel: string) => [...caixa.querySelectorAll(sel)] as HTMLElement[];
const clicar = async (el: Element | null) => { expect(el).not.toBeNull(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
async function digitar(el: Element | null, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function sair(el: Element | null) { await act(async () => { (el as HTMLElement).dispatchEvent(new FocusEvent("focusout", { bubbles: true })); }); await esperar(); }
async function foto(input: Element | null) {
  expect(input).not.toBeNull();
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" })] });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}
const fila = () => banco.fila();
const situacao = () => $("[data-sync]")?.getAttribute("data-sync");

async function abrirOs(atividadeId = "aA", equipamentoId?: string) {
  const { VistaOs } = await import("@/components/tecnico/execucao");
  await montar(createElement(VistaOs, { atividadeId, equipamentoId }));
  await esperarAte(() => !!$("[data-vista]") && $("[data-vista]")!.getAttribute("data-vista") !== null && !caixa.querySelector(".animate-spin:not([data-sync] *)"), "OS carregada");
}

/* ═════════════════════════ regras puras ═════════════════════════ */
describe("modo técnico (puro, roda no middleware)", () => {
  it("técnico puro = perfil que cabe no de Técnico e vê OS; admin, supervisor, financeiro e perfil com algo a mais NÃO", () => {
    expect(ehTecnicoPuro("TECNICO", PRESETS.TECNICO)).toBe(true);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.TECNICO)).toBe(true); // vale o perfil, não o rótulo
    expect(ehTecnicoPuro("OPERADOR", PRESETS.AUXILIAR)).toBe(true);
    expect(ehTecnicoPuro("ADMIN", PRESETS.TECNICO)).toBe(false);
    expect(ehTecnicoPuro("SUPER_ADMIN", PRESETS.TECNICO)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.SUPERVISOR)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", PRESETS.FINANCEIRO)).toBe(false);
    expect(ehTecnicoPuro("OPERADOR", montarPermissoes({ ordens: ["visualizar"], clientes: ["visualizar"] }))).toBe(false); // uma permissão a mais
    expect(ehTecnicoPuro("OPERADOR", montarPermissoes({ equipamentos: ["visualizar"] }))).toBe(false); // não vê OS
    expect(ehTecnicoPuro("OPERADOR", null)).toBe(false);
    // o modo só liga com o técnico ligado (mesmo e-mail) — sem vínculo, segue no sistema como antes
    expect(emModoTecnico({ role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: "t1" })).toBe(true);
    expect(emModoTecnico({ role: "TECNICO", permissoes: PRESETS.TECNICO, tecnicoId: null })).toBe(false);
    expect(emModoTecnico({ role: "OPERADOR", permissoes: permissoesTotais(), tecnicoId: "t1" })).toBe(false);
  });

  it("para onde o técnico puro vai: o sistema leva a Meu dia; link antigo de execução abre a mesma atividade no app", () => {
    expect(destinoModoTecnico("/dashboard")).toBe("/tecnico");
    expect(destinoModoTecnico("/")).toBe("/tecnico");
    expect(destinoModoTecnico("/ordens")).toBe("/tecnico");
    expect(destinoModoTecnico("/clientes/123")).toBe("/tecnico");
    expect(destinoModoTecnico("/ordens/os1/atividades/at9/executar")).toBe("/tecnico?ver=os&a=at9");
    expect(destinoModoTecnico("/tecnicos")).toBe("/tecnico"); // cadastro de técnicos ≠ app do técnico
    for (const livre of ["/tecnico", "/veiculos/checklist", "/sem-permissao", "/offline", "/api/tecnico/sync", "/api/ordens/1"]) expect(destinoModoTecnico(livre)).toBeNull();
  });

  it("cartão: endereço numa linha, rota (coordenadas ou endereço), hora (meia-noite = sem horário), ordem do dia", () => {
    expect(enderecoEmLinha({ logradouro: "Rua A", numero: "10", complemento: "sala 2", bairro: "Centro", cidade: "Santos", estado: "SP" })).toBe("Rua A, 10 (sala 2) — Centro, Santos/SP");
    expect(enderecoEmLinha({ cidade: "Santos" })).toBe("Santos");
    expect(enderecoEmLinha(null)).toBe("");
    expect(linkRota({ latitude: -23.5, longitude: -46.6, logradouro: "x" })).toBe("https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6");
    expect(linkRota({ latitude: 0, longitude: 0, logradouro: "Rua A", cidade: "Santos", cep: "11000-000" })).toContain("destination=Rua%20A%20%E2%80%94%20Santos%2011000-000");
    expect(linkRota({})).toBeNull();
    expect(horaMarcada("2026-10-20T11:30:00.000Z")).toBe("08:30"); // Brasília
    expect(horaMarcada("2026-10-20T03:00:00.000Z")).toBeNull();
    const l = [{ dataAgendada: "2026-10-20T17:00:00Z", hora: "14:00", osNumero: "OS-2" }, { dataAgendada: "2026-10-20T03:00:00Z", hora: null, osNumero: "OS-1" }, { dataAgendada: "2026-10-20T11:30:00Z", hora: "08:30", osNumero: "OS-3" }];
    expect(ordenarDoDia(l).map((x) => x.osNumero)).toEqual(["OS-3", "OS-2", "OS-1"]);
  });

  it("medição digitada no celular: vírgula decimal, negativo, vazio; texto inválido não vira número", async () => {
    const { lerNumero } = await import("@/components/tecnico/equipamento");
    expect([lerNumero("12,5"), lerNumero("-3"), lerNumero(" 118.5 "), lerNumero("1.234,5"), lerNumero("")]).toEqual([12.5, -3, 118.5, 1234.5, null]);
    expect(lerNumero("abc")).toBeNaN();
    expect(lerNumero("12,5,1")).toBeNaN();
  });
});

/* ═════════════════════════ telas ═════════════════════════ */
describe("Meu dia", () => {
  it("cartões na ordem do servidor (horário), com cliente, endereço, rota, horário, situação e nº de equipamentos; prepara as OS para abrir sem sinal", async () => {
    const { MeuDia } = await import("@/components/tecnico/meu-dia");
    await montar(createElement(MeuDia));
    await esperarAte(() => $$("[data-cartao]").length === 3, "3 cartões");
    expect($$("[data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["aB", "aA", "aG"]);
    expect($$("[data-hora]").map((h) => h.textContent)).toEqual(["08:30", "14:00", "—"]);
    const c = $("[data-cartao=aA]")!;
    expect(c.textContent).toContain("Hospital Santa Luzia");
    expect(c.textContent).toContain("Av. Paulista, 1000 — São Paulo/SP");
    expect(c.querySelector("[data-status]")!.textContent).toBe("Agendada");
    expect(c.querySelector("[data-equipamentos]")!.textContent).toContain("2 equipamentos");
    expect(c.querySelector<HTMLAnchorElement>("[data-rota]")!.href).toContain("google.com/maps/dir/");
    expect($("h1")!.textContent).toMatch(/, João$/);
    // as 3 OS ficam guardadas no aparelho
    await esperarAte(() => fetchFalso.mock.calls.filter(([u]) => String(u).startsWith("/api/tecnico/atividades/")).length === 3, "retratos baixados");
    await esperar();
    expect((await banco.retratos()).map((r) => r.atividadeId).sort()).toEqual(["aA", "aB", "aG"]);
    // tocar no cartão abre a OS no app
    await clicar(c.querySelector("button"));
    expect(window.location.search).toBe("?ver=os&a=aA");
  });

  it("SEM SINAL: mostra o Meu dia guardado (com a hora) e o indicador diz Offline", async () => {
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    online = false;
    const { MeuDia } = await import("@/components/tecnico/meu-dia");
    await montar(createElement(MeuDia));
    await esperarAte(() => $$("[data-cartao]").length === 3, "cartões guardados");
    expect(caixa.textContent).toMatch(/Atualizado às \d\d:\d\d/);
    await esperarAte(() => situacao() === "offline", "offline");
  });
});

describe("execução guiada", () => {
  it("TUDO OK marca só os sem resposta (medição fica); medição grava número + unidade; tudo SEM SINAL fica na fila; o sinal volta e sobe", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA", "eqA");
    expect($("[data-vista=equipamento]")).not.toBeNull();
    expect($("[data-progresso]")!.textContent).toBe("0 de 3");
    await clicar($("[data-tudo-ok]"));
    await esperarAte(() => $("[data-progresso]")!.textContent === "2 de 3", "TUDO OK aplicado");
    expect($$("[data-item=i1] [data-chip=OK], [data-item=i2] [data-chip=OK]").map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "true"]);
    expect($("[data-tudo-ok]")!.hasAttribute("disabled")).toBe(true);
    // medição: texto inválido não grava; "118,5" grava 118.5 com a unidade do item
    const campo = $<HTMLInputElement>("[data-item=m1] input")!;
    await digitar(campo, "abc"); await sair(campo);
    expect($("[data-item=m1]")!.textContent).toContain("Número inválido");
    await digitar(campo, "118,5"); await sair(campo);
    await esperarAte(() => $("[data-progresso]")!.textContent === "3 de 3", "medição gravada");
    const ops = await fila();
    expect(ops.map((o) => [o.tipo, o.estado])).toEqual([["iniciar", "pendente"], ["tudoOk", "pendente"], ["resposta", "pendente"]]);
    expect(ops[2]).toMatchObject({ equipamentoId: "eqA", itemId: "m1", dados: { valor: 118.5 } });
    expect(enviadas).toEqual([]); // sem sinal: nada saiu
    await esperarAte(() => situacao() === "offline", "indicador offline");
    // ainda falta a foto pedida pelo item 1 → concluir mostra o que falta
    await clicar($("[data-concluir-equipamento]"));
    expect($("[data-faltas]")!.textContent).toContain("foto em “Limpeza dos filtros”");
    await foto($("[data-item=i1] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-item=i1] [data-miniatura]"), "miniatura da foto");
    expect($("[data-item=i1] [data-miniatura]")!.textContent).toContain("no aparelho");
    await clicar($("[data-concluir-equipamento]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "foi para o próximo");
    // o sinal volta: sobe tudo, em ordem, e o indicador fica Sincronizado
    online = true;
    await act(async () => { window.dispatchEvent(new Event("online")); });
    await motor.sincronizar(true);
    await esperarAte(() => situacao() === "sincronizado", "sincronizado");
    expect(enviadas.map((o) => o.tipo)).toEqual(["iniciar", "tudoOk", "resposta", "foto"]); // já estava atendido: concluir o equipamento não grava nada a mais
  });

  it("“Atenção” só salva com foto + observação; grava status + observação; a foto vai junto", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA", "eqA");
    await clicar($("[data-item=i2] [data-chip=ATENCAO]"));
    expect($("[data-modal-atencao]")).not.toBeNull();
    const salvar = () => $("[data-salvar-atencao]")!;
    expect(salvar().hasAttribute("disabled")).toBe(true);
    await foto($("[data-modal-atencao] input[data-foto-input]"));
    await esperarAte(() => !!$("[data-modal-atencao] [data-miniatura]"), "foto no modal");
    expect(salvar().hasAttribute("disabled")).toBe(true); // falta a observação
    await digitar($("[data-modal-atencao] textarea"), "Bandeja com lodo");
    await esperarAte(() => !salvar().hasAttribute("disabled"), "salvar habilitado");
    await clicar(salvar());
    await esperarAte(() => !$("[data-modal-atencao]"), "modal fechado");
    expect($("[data-item=i2] [data-chip=ATENCAO]")!.getAttribute("aria-pressed")).toBe("true");
    expect($("[data-resumo-atencao]")!.textContent).toContain("Bandeja com lodo");
    const ops = await fila();
    expect(ops.map((o) => o.tipo)).toEqual(["iniciar", "foto", "resposta"]);
    expect(ops[1]).toMatchObject({ dados: { itemId: "i2", clientId: expect.any(String), dataUrl: "data:image/jpeg;base64,/9j/FOTO" } });
    expect(ops[2]).toMatchObject({ itemId: "i2", dados: { status: "ATENCAO", observacao: "Bandeja com lodo" } });
  });

  it("serviço extra entra na MESMA OS (com foto) e aparece destacado; concluir com pendência mostra o que falta e não grava", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirOs("aA");
    expect($$("[data-equip-linha]").map((l) => l.getAttribute("data-situacao"))).toEqual(["nao-iniciado", "nao-iniciado"]);
    await clicar($("[data-novo-adicional]"));
    const salvar = () => $("[data-salvar-adicional]")!;
    expect(salvar().hasAttribute("disabled")).toBe(true);
    await digitar($("[data-modal-adicional] textarea"), "Troca do controle remoto");
    await foto($("[data-modal-adicional] input[data-foto-input]"));
    await clicar(salvar());
    await esperarAte(() => $$("[data-adicional]").length === 1, "adicional na lista");
    expect($("[data-adicional]")!.textContent).toContain("Adicional");
    expect($("[data-adicional]")!.textContent).toContain("Troca do controle remoto");
    const ops = await fila();
    expect(ops.map((o) => o.tipo)).toEqual(["iniciar", "adicional", "adicionalFoto"]);
    const ad = ops[1] as any;
    expect(ad.dados).toMatchObject({ descricao: "Troca do controle remoto", equipamentoId: null, clientId: expect.any(String) });
    expect((ops[2] as any).dados.servicoClientId).toBe(ad.dados.clientId);
    // concluir: nenhum equipamento atendido → mostra o motivo, nada vai para a fila
    await clicar($("[data-concluir-atividade]"));
    expect($("[data-pendencias]")!.textContent).toContain("vincule pelo menos 1 equipamento atendido");
    expect((await fila()).some((o) => o.tipo === "concluir")).toBe(false);
  });
});

/* ═════════════════════════ escritório ═════════════════════════ */
async function montarSimples(el: any, role = "OPERADOR", permissoes = permissoesTotais()) {
  const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
  caixa = document.createElement("div");
  document.body.appendChild(caixa);
  root = createRoot(caixa);
  await act(async () => { root.render(createElement(PermissoesProvider, { role, permissoes, children: el })); });
  await esperar(2);
}
const ADICIONAL = {
  id: "s1", descricao: "Troca do controle remoto", statusCobranca: "A_AVALIAR" as const, criadoEm: "2026-10-20T15:00:00Z",
  atividade: { titulo: "Preventiva" }, equipamento: { nome: "Split Sala 2", marca: "Daikin", modelo: "FTXS", patrimonio: "AC-02" },
  criadoPor: { nome: "João" }, fotos: [{ id: "f1" }],
};

describe("escritório: adicional na OS e no relatório", () => {
  it("painel da OS: o escritório decide a cobrança (grava e desfaz se falhar); o técnico só vê", async () => {
    const { OsAdicionais } = await import("@/components/os/os-adicionais");
    const chamadas: { url: string; corpo: unknown }[] = [];
    let ok = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(ok ? {} : { erro: "Sem permissão para esta ação" }), { status: ok ? 200 : 403, headers: { "content-type": "application/json" } });
    }));
    try {
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [ADICIONAL] }));
      expect($("[data-os-adicionais]")!.textContent).toContain("Serviços adicionais pedidos na visita (1)");
      expect($("[data-a-avaliar]")!.textContent).toBe("1 a avaliar para cobrança");
      expect($("[data-adicional-os=s1]")!.textContent).toContain("Split Sala 2 · TAG AC-02");
      await clicar($("[data-cobranca=COBRAR]"));
      expect(chamadas).toEqual([{ url: "/api/ordens/osA/servicos-adicionais/s1", corpo: { statusCobranca: "COBRAR" } }]);
      expect($("[data-cobranca=COBRAR]")!.getAttribute("aria-pressed")).toBe("true");
      expect($("[data-a-avaliar]")).toBeNull();
      ok = false;
      await clicar($("[data-cobranca=NAO_COBRAR]"));
      await esperar();
      expect($("[data-cobranca=COBRAR]")!.getAttribute("aria-pressed")).toBe("true"); // desfeito
      expect($("[data-os-adicionais]")!.textContent).toContain("Sem permissão para esta ação");
      act(() => root.unmount()); caixa.remove();
      // técnico (mesmo com "editar OS"): só a situação, sem botões
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [ADICIONAL] }), "TECNICO", PRESETS.TECNICO);
      expect($("[data-cobranca=COBRAR]")).toBeNull();
      expect($("[data-adicional-os=s1]")!.textContent).toContain("A avaliar");
      act(() => root.unmount()); caixa.remove();
      // sem adicional: nada aparece
      await montarSimples(createElement(OsAdicionais, { osId: "osA", adicionais: [] }));
      expect($("[data-os-adicionais]")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });

  it("documento: medição com o valor e a unidade; áudio e cobrança só na versão interna; adicional em destaque", async () => {
    const { BlocoEquip, SecaoAdicionais } = await import("@/components/relatorio/relatorio-os-documento");
    const bloco = {
      id: "eqA", local: { principal: "Sala 1", complemento: null, unidade: "Matriz" }, titulo: "Split Sala 1", descricao: "Split", fabricante: "Daikin", tag: "AC-01", numeroSerie: null,
      checklist: [], observacoes: [], fotos: [],
      checklistTipo: [{ atividade: "Preventiva", itens: [
        { texto: "Dreno e bandeja", status: "ATENCAO" as const, observacao: "Bandeja com lodo", medicao: null, audio: true },
        { texto: "Pressão de sucção", status: null, observacao: null, medicao: { valor: 118.5, unidade: "psi" }, audio: false },
      ] }],
      resumoChecklist: { ok: 0, atencao: 1, naoSeAplica: 0, medicoes: 1 },
    };
    const ad = [{ id: "s1", descricao: "Troca do controle remoto", atividade: "Preventiva", equipamento: "Split Sala 2", fotos: [], statusCobranca: "COBRAR" as const, criadoPor: "João" }];
    const doc = (interna: boolean) => createElement("div", null, createElement(BlocoEquip, { b: bloco, checklist: true, fotos: true, interna }), createElement(SecaoAdicionais, { adicionais: ad, fotos: true, interna }));
    await montarSimples(doc(true));
    expect($("[data-medicao-relatorio]")!.textContent).toBe("118,5 psi");
    expect($("[data-resumo-checklist]")!.textContent).toContain("1 medição");
    expect($("[data-audio-relatorio]")!.textContent).toContain("Observação em áudio");
    expect($("[data-adicional-relatorio]")!.textContent).toContain("Adicional");
    expect($("[data-cobranca]")!.textContent).toBe("Cobrança: Cobrar");
    act(() => root.unmount()); caixa.remove();
    await montarSimples(doc(false));
    expect($("[data-medicao-relatorio]")!.textContent).toBe("118,5 psi");
    expect($("[data-audio-relatorio]")).toBeNull();
    expect($("[data-cobranca]")).toBeNull();
    expect($("[data-adicional-relatorio]")!.textContent).toContain("Troca do controle remoto");
  });
});
