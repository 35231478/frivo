// @vitest-environment happy-dom
/**
 * "A caminho" / "Cheguei" pelo CARD do Meu dia — o app do técnico num DOM de verdade, com o banco do
 * aparelho de verdade (IndexedDB via fake-indexeddb), o motor de sincronização real e as vistas
 * trocando pela URL, como no app. O servidor é simulado, mas decide o aviso com as MESMAS regras
 * puras do servidor real (janela de tempo).
 *
 * O toque é o mesmo de antes (um por evento, por dia; horário registrado; aviso se houver sinal). O
 * que mudou é ONDE ele acontece e o que o "Cheguei" faz:
 *  - antes de chegar o card só se lê: tocar nele EXPANDE (descrição do chamado, orientação do
 *    escritório); a OS não abre — nem pelo card, nem por link direto, nem pelo atalho da câmera;
 *  - "Cheguei" (principal) registra a chegada, avisa o cliente e ENTRA na OS — sem sinal também;
 *  - "A caminho" é opcional e discreto: avisa e some, deixando só o "Cheguei";
 *  - a Câmera só aparece depois de chegar; OS em andamento entra direto, sem "Cheguei" de novo;
 *  - dentro da OS não há mais botão: só o registro do que foi tocado hoje.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { aplicarToque, decidirAviso, horarioDoToque, juntarAvisos, recadoAviso, rotuloAviso, type AvisosTela, type EventoAviso, type StatusAviso } from "@/lib/tecnico/aviso-cliente";
import { estadoDoCartao, podeEntrar, situacaoDoCartao } from "@/lib/tecnico/chegada";
import { aplicarPrivacidade, descricaoParaApp } from "@/lib/tecnico/cartao";
import { MSG_SEM_ESPACO } from "@/lib/tecnico/offline/armazenamento";
import type { CartaoTela, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));
// Os toasts da casa ficam numa lista do módulo (e somem sozinhos, por tempo): o teste anota o que foi dito
const ditos: string[] = [];

/* ───────── relógio: meio-dia de Brasília, andando só quando o teste manda ───────── */
const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const HOJE = "2026-11-12";
const AMANHA = "2026-11-13";
const MIN = 60_000;
const passar = (ms: number) => vi.setSystemTime(Date.now() + ms);

/* ───────── servidor simulado (decide com as regras puras do servidor real) ───────── */
let online = true;
let enviadas: any[] = [];
let lotes: any[] = [];
let recados: string[] = [];
let servidor: { avisos: Record<string, AvisosTela>; status: Record<string, string>; ligado: boolean; semEmail: boolean };
let ajustar: (r: any) => any = (r) => r;
let ajustarCartao: (c: any) => any = (c) => c;

const PEDIDO = "Ar da recepção pingando no balcão.";
const RODAPE = "[Chamado via QR Code] Solicitante: Marta Lima · E-mail: marta@hospital.com · Telefone: (11) 97777-1111";
const ORIENTACAO = "Levar bomba de dreno.\n\nEntrar pela portaria 2.";
const ROTA = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-23.5%2C-46.6";

const CARTOES: Record<string, Record<string, unknown>> = {
  aC: { hora: "09:00", cliente: "Padaria Pão Quente", descricao: "Limpeza do forno" },
  aA: { hora: "13:00", cliente: "Hospital Santa Luzia", descricao: `${PEDIDO}\n\n${RODAPE}`, chamado: true, orientacao: ORIENTACAO },
  aB: { hora: "15:00", cliente: "Escola Viva", descricao: "Preventiva mensal" },
  aD: { hora: "10:00", cliente: "Mercado Bom Preço", descricao: "Instalação", dia: AMANHA },
};
function cartao(id: string): CartaoTela {
  return ajustarCartao({
    atividadeId: id, osId: `os-${id}`, osNumero: `OS-${id}`, titulo: "Atendimento", tipoOs: null, status: servidor.status[id] ?? "AGENDADA", prioridade: "NORMAL",
    dataAgendada: null, dia: HOJE, duracaoMin: 60, telefone: "(11) 3333-0000", unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: ROTA,
    equipamentos: 1, atendidos: 0, adicionais: 0, chamado: false, orientacao: "", avisos: { ...servidor.avisos[id] }, ...CARTOES[id],
  }) as CartaoTela;
}
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = { id: "eqA", titulo: "Split Sala 1", descricao: "Split Sala 1", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } };
function retrato(id: string): RetratoAtividade {
  const status = servidor.status[id] ?? "AGENDADA";
  return ajustar({
    cartao: cartao(id),
    execucao: {
      atividade: { id, titulo: "Atendimento", status, tipoOs: null }, os: { id: `os-${id}`, numero: `OS-${id}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: status === "CONCLUIDA", adicionais: [], avisos: { ...servidor.avisos[id] },
      equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [{ ...info, tipoEquipamentoId: "te1", qr: null }],
    checklistsPorTipo: {},
    cadastro: null,
    avisoCliente: servidor.ligado ? { empresa: "Clima Total", whatsapp: "(11) 96666-5555" } : null,
    geradoEm: new Date().toISOString(),
  }) as RetratoAtividade;
}

const TECNICO = { id: "t1", nome: "João Silva" };
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: TECNICO, dia: HOJE, atividades: ["aC", "aA", "aB"].map(cartao), anteriores: [] });
  if (url.startsWith("/api/tecnico/agenda")) return json({ tecnico: TECNICO, dias: [{ dia: HOJE, atividades: [cartao("aA")] }, { dia: AMANHA, atividades: [cartao("aD")] }] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    lotes.push(corpo);
    enviadas.push(...corpo.operacoes);
    return json({
      resultados: corpo.operacoes.map((o: any) => {
        if (o.tipo === "iniciar") servidor.status[o.atividadeId] = "EM_ANDAMENTO";
        if (o.tipo !== "avisoCliente") return { id: o.id, ok: true, status: 200, dados: {} };
        const evento = o.dados.evento as EventoAviso;
        const doDia = (servidor.avisos[o.atividadeId] ??= {});
        const ja = doDia[evento];
        if (ja) return { id: o.id, ok: true, status: 200, dados: { evento, em: ja.em, status: ja.status, jaEstava: true, aviso: null } };
        const { registradoEm, atrasoMs } = horarioDoToque(o.em, Date.now(), corpo.agora);
        const d = decidirAviso({ ligado: servidor.ligado, atrasoMs, evento, chegadaRegistrada: !!doDia.CHEGOU });
        const status: StatusAviso = !d.enviar ? d.status : servidor.semEmail ? "SEM_DESTINO" : "ENVIADO";
        doDia[evento] = { em: registradoEm.toISOString(), status };
        return { id: o.id, ok: true, status: 201, dados: { evento, em: registradoEm.toISOString(), status, jaEstava: false, aviso: recadoAviso(evento, status) } };
      }),
    });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;

function novoMotor() {
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  motor.aoAvisar = (t) => { recados.push(t); };
}

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/aviso-cliente"), import("@/components/ui/avisos")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; lotes = []; recados = []; ditos.length = 0; ajustar = (r) => r; ajustarCartao = (c) => c; fetchFalso.mockClear();
  servidor = { avisos: {}, status: { aB: "EM_ANDAMENTO", aC: "CONCLUIDA" }, ligado: true, semEmail: false };
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.localStorage.clear();
  banco = await BancoTecnico.abrir("uT");
  novoMotor();
  window.history.replaceState(null, "", "/tecnico");
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation((mensagem: string) => { ditos.push(mensagem); });
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = "";
  root = undefined as unknown as Root;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") {
  for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };

const card = (id = "aA") => $(`[data-cartao="${id}"]`);
const estado = (id = "aA") => card(id)?.getAttribute("data-estado");
const corpo = (id = "aA") => $(`[data-cartao="${id}"] [data-corpo-cartao]`);
/** O BOTÃO de um evento (antes do toque) */
const botao = (evento: EventoAviso, id = "aA") => $<HTMLButtonElement>(`[data-cartao="${id}"] button[data-aviso="${evento}"]`);
/** O REGISTRO de um evento (depois do toque): só leitura */
const registro = (evento: EventoAviso) => $(`[data-aviso="${evento}"][data-aviso-feito]`);
const dito = (evento: EventoAviso) => registro(evento)?.getAttribute("aria-label") ?? null;
/** Os botões e links da barra do card, na ordem */
const acoes = (id = "aA") => [...(card(id)?.querySelectorAll("[data-acoes-cartao] a, [data-acoes-cartao] button") ?? [])].map((b) => texto(b));
const vista = () => $("[data-vista]")?.getAttribute("data-vista") ?? null;
const avisosEnviados = () => enviadas.filter((o) => o.tipo === "avisoCliente");
const naFila = async () => (await banco.fila()).filter((o) => o.tipo === "avisoCliente" && o.estado !== "enviada");
const toasts = () => [...ditos];

/** O app: as vistas trocam pela URL (Meu dia · Agenda · OS), com os avisos e confirmações da casa */
async function abrirApp(config?: any, url = "/tecnico") {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia, Agenda } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { Avisos } = await import("@/components/ui/avisos");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e, camera: v.cam });
    return createElement(v.ver === "agenda" ? Agenda : MeuDia);
  }
  window.history.replaceState(null, "", url);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: [createElement(Avisos, { key: "avisos" }), createElement(Vistas, { key: "vistas" })] })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela carregada");
  await esperar();
}
const abrirMeuDia = async (config?: any) => { await abrirApp(config); await esperarAte(() => $$("[data-cartao]").length === 3, "3 cards"); await esperar(); };
/** Fecha o app e abre de novo (o que estava no aparelho continua lá) */
async function reabrir(config?: any, url = "/tecnico") {
  act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
  novoMotor();
  await abrirApp(config, url);
}
/** Deixa o dia no aparelho (lista + as OS), como depois de abrir o app com sinal */
async function guardarNoAparelho() {
  await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
  await motor.prepararSemSinal(["aC", "aA", "aB"]);
}
async function voltarOSinal() {
  online = true;
  await act(async () => { await motor.sincronizar(true); });
  await esperar();
}
const voltarAoMeuDia = async () => { await clicar([...$$("button")].find((b) => texto(b) === "Meu dia")); await esperarAte(() => vista() === "dia" && $$("[data-cartao]").length === 3, "Meu dia"); await esperar(); };

/* ═════════════════════════ antes de chegar ═════════════════════════ */
describe("card ANTES de chegar: só se lê", () => {
  it("ações: 'Como chegar' e 'Cheguei' (principal, cheio, na cor da marca); 'A caminho' discreto embaixo; sem 'Ligar' e sem 'Câmera'", async () => {
    await abrirMeuDia();
    expect(estado()).toBe("antes");
    expect(acoes()).toEqual(["Como chegar", "Cheguei", "Avisar que estou a caminho"]);
    const cheguei = botao("CHEGOU")!;
    expect(cheguei.className).toContain("bg-acento");
    expect(cheguei.className).toContain("text-white");
    expect(cheguei.disabled).toBe(false);
    // "A caminho" é secundário: sem preenchimento, texto apagado — e o "Cheguei" não depende dele
    const aCaminho = botao("A_CAMINHO")!;
    expect(aCaminho.className).not.toContain("bg-");
    expect(aCaminho.className).toContain("text-ink-muted");
    for (const el of [cheguei, aCaminho, corpo(), card()!.querySelector("[data-rota]")]) expect(el!.className).toContain("touch-target");
    expect(card()!.querySelector("[data-ligar], a[href^='tel:']")).toBeNull();
    expect(card()!.querySelector("[data-camera-cartao]")).toBeNull();
    expect(texto(card()!.querySelector("[data-status]"))).toBe("Agendada");
    expect(registro("A_CAMINHO")).toBeNull();
  });

  it("tocar no corpo (ou na seta) NÃO abre a OS: expande para baixo e recolhe; os outros cards continuam na ordem", async () => {
    await abrirMeuDia();
    expect(card()!.querySelector("[data-expande]")).not.toBeNull(); // seta para baixo, não para a direita
    expect(card()!.querySelector("[data-abre-os]")).toBeNull();
    expect(corpo()!.getAttribute("aria-expanded")).toBe("false");
    expect($("[data-detalhes-cartao]")).toBeNull();

    await clicar(corpo());
    expect(window.location.search).toBe("");
    expect(vista()).toBe("dia");
    expect(corpo()!.getAttribute("aria-expanded")).toBe("true");
    const detalhes = card()!.querySelector("[data-detalhes-cartao]")!;
    expect(corpo()!.getAttribute("aria-controls")).toBe(detalhes.id);
    // dentro do card, entre o corpo e as ações: empurra os de baixo, não cobre nada
    expect([...card()!.children].map((x) => x.getAttribute("data-corpo-cartao") !== null ? "corpo" : x.getAttribute("data-detalhes-cartao") !== null ? "detalhes" : "acoes")).toEqual(["corpo", "detalhes", "acoes"]);
    expect($$("[data-cartao]").map((c) => c.getAttribute("data-cartao"))).toEqual(["aC", "aA", "aB"]);
    expect(enviadas).toEqual([]);

    await clicar(corpo());
    expect($("[data-detalhes-cartao]")).toBeNull();
    expect(corpo()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("expandido: o que o cliente pediu ao abrir o chamado e a orientação do escritório, cada um com o seu título", async () => {
    await abrirMeuDia();
    await clicar(corpo());
    const d = card()!.querySelector("[data-detalhes-servico]")!;
    expect([...d.querySelectorAll("h4")].map((h) => texto(h))).toEqual(["O que o cliente pediu", "Orientação do escritório"]);
    expect(d.querySelector("[data-descricao]")!.textContent).toBe(`${PEDIDO}\n\n${RODAPE}`);
    expect(d.querySelector("[data-orientacao]")!.textContent).toBe(ORIENTACAO);
    expect(texto(card()!.querySelector("[data-dica-cheguei]"))).toBe("“Cheguei” registra o horário, avisa o cliente e abre a OS.");
  });

  it("OS aberta pelo escritório (não veio de chamado): 'Descrição do serviço'; sem nada escrito, o card diz que não há", async () => {
    CARTOES.aA = { ...CARTOES.aA, chamado: false, descricao: "Trocar o compressor", orientacao: "" };
    try {
      await abrirMeuDia();
      await clicar(corpo());
      expect([...card()!.querySelectorAll("[data-detalhes-servico] h4")].map((h) => texto(h))).toEqual(["Descrição do serviço"]);
      expect(card()!.querySelector("[data-orientacao]")).toBeNull();
      act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
      CARTOES.aA = { ...CARTOES.aA, descricao: "" };
      await abrirMeuDia();
      await clicar(corpo());
      expect(texto(card()!.querySelector("[data-sem-detalhes]"))).toBe("Sem descrição nem orientação do escritório.");
    } finally {
      CARTOES.aA = { hora: "13:00", cliente: "Hospital Santa Luzia", descricao: `${PEDIDO}\n\n${RODAPE}`, chamado: true, orientacao: ORIENTACAO };
    }
  });

  it("'Exibir dados do cliente' DESLIGADO: o pedido e a orientação ficam; saem o nome de quem pediu, e-mail, telefone, cliente e endereço", async () => {
    const semDados = { ...CONFIG_APP_PADRAO, exibirDadosCliente: false, exibirContatosCliente: false };
    ajustarCartao = (c) => aplicarPrivacidade(c, semDados); // o servidor já manda sem a identidade
    await abrirMeuDia(semDados);
    await clicar(corpo());
    expect(card()!.querySelector("[data-descricao]")!.textContent).toBe(PEDIDO);
    expect(card()!.querySelector("[data-orientacao]")!.textContent).toBe(ORIENTACAO);
    for (const dado of ["Marta", "marta@", "97777", "Hospital Santa Luzia", "Av. Paulista", "Como chegar"]) expect(texto(), dado).not.toContain(dado);
    expect(acoes()).toEqual(["Cheguei", "Avisar que estou a caminho"]);
  });

  it("a chave foi desligada com a lista antiga ainda no aparelho: a tela tira a identidade de quem pediu mesmo assim", async () => {
    await guardarNoAparelho(); // guardado COM o rodapé do solicitante
    online = false;
    await abrirMeuDia({ ...CONFIG_APP_PADRAO, exibirDadosCliente: false });
    await clicar(corpo());
    expect(card()!.querySelector("[data-descricao]")!.textContent).toBe(PEDIDO);
    expect(texto()).not.toContain("Marta");
  });
});

/* ═════════════════════════ a caminho ═════════════════════════ */
describe("'A caminho': opcional — avisa e some, deixando o 'Cheguei'", () => {
  it("com sinal: sobe na hora com o horário do toque; a ação some; fica o registro 'avisado às 12:00' e o card continua fechado para a OS", async () => {
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "aviso confirmado");
    expect(avisosEnviados()).toHaveLength(1);
    expect(avisosEnviados()[0]).toMatchObject({ tipo: "avisoCliente", atividadeId: "aA", em: new Date(MEIO_DIA).toISOString(), dados: { evento: "A_CAMINHO" } });
    expect(lotes[0].agora).toBe(new Date(MEIO_DIA).toISOString());
    expect(estado()).toBe("a-caminho");
    expect(botao("A_CAMINHO")).toBeNull();
    expect(acoes()).toEqual(["Como chegar", "Cheguei"]);
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect([...registro("A_CAMINHO")!.querySelectorAll("span > span")].map((x) => texto(x))).toEqual(["A caminho", "avisado às 12:00"]);
    expect(registro("A_CAMINHO")!.tagName).toBe("P"); // registro, não botão
    expect(texto(card()!.querySelector("[data-status]"))).toBe("A caminho");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho."]);
    // ainda não chegou: o card não abre a OS (expande) e não tem Câmera
    expect(window.location.search).toBe("");
    await clicar(corpo());
    expect(vista()).toBe("dia");
    expect(card()!.querySelector("[data-detalhes-cartao]")).not.toBeNull();
    expect(card()!.querySelector("[data-camera-cartao]")).toBeNull();
    // só o card tocado mudou
    expect(estado("aB")).toBe("em-andamento");
  });

  it("tocar DUAS vezes seguidas manda UMA gravação só", async () => {
    await abrirMeuDia();
    const b = botao("A_CAMINHO")!;
    await act(async () => { b.click(); b.click(); });
    await esperar();
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "aviso confirmado");
    expect(avisosEnviados()).toHaveLength(1);
  });

  it("cliente sem e-mail: o horário fica e o registro diz que não havia e-mail — sem mostrar dado do cliente", async () => {
    servidor.semEmail = true;
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "SEM_DESTINO", "sem destino");
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · sem e-mail para avisar");
    expect(recados).toEqual(["Horário registrado. O cliente não tem e-mail para receber o aviso."]);
  });

  it("o que já foi avisado hoje vem do servidor com a lista (outro aparelho, ou o app reaberto): o card já abre em 'a caminho'", async () => {
    servidor.avisos.aA = { A_CAMINHO: { em: new Date(MEIO_DIA - 30 * MIN).toISOString(), status: "ENVIADO" } };
    await abrirMeuDia();
    expect(estado()).toBe("a-caminho");
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 11:30");
    expect(acoes()).toEqual(["Como chegar", "Cheguei"]);
  });

  it("SEM SINAL: o toque fica no aparelho com o horário local; nada é enviado; o técnico é avisado da regra", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    expect(avisosEnviados()).toHaveLength(0);
    const [op] = await naFila();
    expect(op).toMatchObject({ tipo: "avisoCliente", em: new Date(MEIO_DIA).toISOString(), dados: { evento: "A_CAMINHO" }, estado: "pendente" });
    expect(registro("A_CAMINHO")!.dataset.avisoFeito).toBe("no-aparelho");
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · aviso a enviar");
    expect(toasts()).toEqual(["Horário registrado no aparelho. Sem sinal, o aviso só sai se ele voltar logo."]);
    expect(acoes()).toEqual(["Como chegar", "Cheguei"]);
  });

  it("SEM SINAL, o sinal volta 2 min depois: o aviso ainda faz sentido — sai, com o horário do toque", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    passar(2 * MIN);
    await voltarOSinal();
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(lotes.at(-1).agora).toBe(new Date(MEIO_DIA + 2 * MIN).toISOString());
    expect(avisosEnviados()[0].em).toBe(new Date(MEIO_DIA).toISOString());
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho."]);
  });

  it("SEM SINAL, o sinal volta 40 min depois: o horário sobe, o cliente NÃO recebe aviso velho e o card diz por quê", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    passar(40 * MIN);
    await voltarOSinal();
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ATRASADO", "registrado sem aviso");
    expect(servidor.avisos.aA.A_CAMINHO).toEqual({ em: new Date(MEIO_DIA).toISOString(), status: "ATRASADO" });
    expect(dito("A_CAMINHO")).toBe("A caminho · 12:00 · sem aviso (sem sinal)");
    expect(recados).toEqual(["Horário registrado. O aviso não foi enviado: faltou sinal na hora do toque."]);
    expect(await naFila()).toHaveLength(0);
  });
});

/* ═════════════════════════ cheguei ═════════════════════════ */
describe("'Cheguei': registra a chegada, avisa o cliente e ENTRA na OS", () => {
  it("direto, sem tocar 'A caminho' antes: sobe a chegada, a OS abre e o atendimento NÃO começa sozinho", async () => {
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(window.location.search).toBe("?ver=os&a=aA");
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "chegada confirmada");
    expect(enviadas.map((o) => [o.tipo, o.dados?.evento])).toEqual([["avisoCliente", "CHEGOU"]]); // nenhum "iniciar", nenhum "A caminho"
    expect($("[data-status]")!.getAttribute("data-status")).toBe("AGENDADA");
    expect(recados).toEqual(["Cliente avisado: técnico no local."]);
  });

  it("dentro da OS não há mais botão de 'A caminho' / 'Cheguei': só o registro, acima dos equipamentos", async () => {
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "chegada confirmada");
    expect($$("button[data-aviso]")).toEqual([]);
    expect(texto()).not.toContain("A caminho");
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:00");
    expect(registro("A_CAMINHO")).toBeNull(); // não tocou: não aparece
    const bloco = $("[data-aviso-cliente]")!;
    const equipamentos = [...document.querySelectorAll("h2")].find((h) => texto(h) === "Equipamentos")!;
    expect(bloco.compareDocumentPosition(equipamentos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // a descrição e a orientação seguem à mão, no cabeçalho da OS
    expect($("header [data-descricao]")!.textContent).toContain(PEDIDO);
    expect($("header [data-orientacao]")!.textContent).toBe(ORIENTACAO);
  });

  it("depois de 'A caminho', 'Cheguei' às 12:25: a OS mostra os dois, cada um com o seu horário", async () => {
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "a caminho confirmado");
    passar(25 * MIN);
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os" && registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "chegada confirmada");
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:25");
    expect(recados).toEqual(["Cliente avisado: técnico a caminho.", "Cliente avisado: técnico no local."]);
    expect(avisosEnviados()).toHaveLength(2);
  });

  it("de volta ao Meu dia: o card diz 'No local', abre a OS pelo corpo, ganha a Câmera e não pede 'Cheguei' de novo", async () => {
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "chegada confirmada");
    await voltarAoMeuDia();
    expect(estado()).toBe("chegou");
    expect(texto(card()!.querySelector("[data-status]"))).toBe("No local");
    expect(botao("CHEGOU")).toBeNull();
    expect(botao("A_CAMINHO")).toBeNull();
    expect(acoes()).toEqual(["Câmera", "Como chegar"]);
    expect(card()!.querySelector("[data-abre-os]")).not.toBeNull();
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:00");
    await clicar(corpo());
    await esperarAte(() => vista() === "os", "abriu a OS");
    expect(window.location.search).toBe("?ver=os&a=aA");
    expect(avisosEnviados()).toHaveLength(1); // entrar de novo não avisa de novo
  });

  it("a Câmera do card (depois de chegar) abre a OS direto na câmera rápida", async () => {
    servidor.avisos.aA = { CHEGOU: { em: new Date(MEIO_DIA - 10 * MIN).toISOString(), status: "ENVIADO" } };
    await abrirMeuDia();
    await clicar(card()!.querySelector("[data-camera-cartao]"));
    await esperarAte(() => !!$("[data-camera-rapida]"), "câmera rápida aberta");
    expect(vista()).toBe("os");
  });

  it("o aparelho não conseguiu guardar o toque: avisa, NÃO entra na OS e o botão volta a valer", async () => {
    await abrirMeuDia();
    vi.spyOn(banco, "enfileirar").mockRejectedValueOnce(new Error("QuotaExceededError"));
    await clicar(botao("CHEGOU"));
    expect(vista()).toBe("dia");
    expect(window.location.search).toBe("");
    expect(toasts()).toEqual([MSG_SEM_ESPACO]);
    expect(estado()).toBe("antes");
    await clicar(botao("CHEGOU")); // agora guarda
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(avisosEnviados()).toHaveLength(1);
  });
});

/* ═════════════════════════ sem sinal ═════════════════════════ */
describe("'Cheguei' SEM SINAL: entrar na OS é local", () => {
  it("entra na OS na hora, com a chegada guardada no aparelho; nada é enviado; o técnico é avisado da regra", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS sem sinal");
    expect(avisosEnviados()).toHaveLength(0);
    const [op] = await naFila();
    expect(op).toMatchObject({ tipo: "avisoCliente", atividadeId: "aA", em: new Date(MEIO_DIA).toISOString(), dados: { evento: "CHEGOU" }, estado: "pendente" });
    expect(registro("CHEGOU")!.dataset.avisoFeito).toBe("no-aparelho");
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · aviso a enviar");
    expect(toasts()).toEqual(["Horário registrado no aparelho. Sem sinal, o aviso só sai se ele voltar logo."]);
    expect(texto($("[data-a-enviar]"))).toContain("1 gravação desta OS no aparelho");
    // a execução está aberta de verdade: dá para trabalhar
    expect($("[data-abrir-camera-rapida]")).not.toBeNull();
    expect($("[data-concluir-atividade]")).not.toBeNull();
  });

  it("o sinal volta 1 min depois: o cliente é avisado da chegada, com o horário do toque", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    passar(MIN);
    await voltarOSinal();
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(avisosEnviados()[0].em).toBe(new Date(MEIO_DIA).toISOString());
    expect(dito("CHEGOU")).toBe("Cheguei · avisado às 12:00");
    expect(recados).toEqual(["Cliente avisado: técnico no local."]);
  });

  it("o sinal só volta 40 min depois: o horário da chegada sobe, o cliente NÃO recebe aviso velho — e a OS seguiu aberta o tempo todo", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    passar(40 * MIN);
    expect(vista()).toBe("os");
    await voltarOSinal();
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ATRASADO", "registrado sem aviso");
    expect(servidor.avisos.aA.CHEGOU).toEqual({ em: new Date(MEIO_DIA).toISOString(), status: "ATRASADO" });
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · sem aviso (sem sinal)");
    expect(recados).toEqual(["Horário registrado. O aviso não foi enviado: faltou sinal na hora do toque."]);
    expect(vista()).toBe("os");
  });

  it("fechar e abrir o app ainda sem sinal: o card continua 'No local' e a OS abre — um toque só", async () => {
    await guardarNoAparelho();
    online = false;
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    passar(3 * MIN);
    await reabrir();
    await esperarAte(() => $$("[data-cartao]").length === 3, "Meu dia do aparelho");
    expect(estado()).toBe("chegou");
    expect(botao("CHEGOU")).toBeNull();
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · aviso a enviar");
    await clicar(corpo());
    await esperarAte(() => vista() === "os", "abriu a OS");
    expect(await naFila()).toHaveLength(1);
    // passada a janela, o registro já diz que o aviso não sai mais
    passar(10 * MIN);
    await reabrir(undefined, "/tecnico?ver=os&a=aA");
    expect(vista()).toBe("os");
    expect(dito("CHEGOU")).toBe("Cheguei · 12:00 · sem aviso (sem sinal)");
  });

  it("a chegada já subiu e o sinal caiu de novo (lista antiga no aparelho): o card sabe pela OS guardada que o técnico chegou", async () => {
    await guardarNoAparelho(); // lista de antes da chegada
    await abrirMeuDia();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "chegada confirmada");
    expect(await banco.fila()).toEqual([]); // subiu e o retrato novo já chegou: nada na fila
    online = false;
    await reabrir();
    await esperarAte(() => $$("[data-cartao]").length === 3, "Meu dia do aparelho");
    await esperarAte(() => estado() === "chegou", "card lê a OS guardada");
    expect(acoes()).toEqual(["Câmera", "Como chegar"]);
  });
});

/* ═════════════════════════ a trava ═════════════════════════ */
describe("a OS só abre depois do 'Cheguei' — por nenhum outro caminho", () => {
  it("link direto para a OS antes de chegar: a execução NÃO abre; aparece o card com o 'Cheguei', que abre", async () => {
    await abrirApp(undefined, "/tecnico?ver=os&a=aA");
    expect(vista()).toBe("os-antes-de-chegar");
    expect(texto($("[data-trava-chegada]"))).toBe("Toque em “Cheguei” para abrir a OS.");
    for (const daExecucao of ["[data-abrir-camera-rapida]", "[data-concluir-atividade]", "[data-equip-linha]", "[data-novo-adicional]"]) expect($(daExecucao), daExecucao).toBeNull();
    expect(acoes()).toEqual(["Como chegar", "Cheguei", "Avisar que estou a caminho"]);
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect($("[data-concluir-atividade]")).not.toBeNull();
  });

  it("atalho da câmera e link de equipamento antes de chegar: também não abrem", async () => {
    await abrirApp(undefined, "/tecnico?ver=os&a=aA&cam=1");
    expect(vista()).toBe("os-antes-de-chegar");
    expect($("[data-camera-rapida]")).toBeNull();
    await reabrir(undefined, "/tecnico?ver=os&a=aA&e=eqA");
    expect(vista()).toBe("os-antes-de-chegar");
  });

  it("'A caminho' não abre a porta: só o 'Cheguei'", async () => {
    servidor.avisos.aA = { A_CAMINHO: { em: new Date(MEIO_DIA - 5 * MIN).toISOString(), status: "ENVIADO" } };
    await abrirApp(undefined, "/tecnico?ver=os&a=aA");
    expect(vista()).toBe("os-antes-de-chegar");
    expect(acoes()).toEqual(["Como chegar", "Cheguei"]);
  });

  it("OS já EM ANDAMENTO (o técnico chegou antes): entra direto pelo card e pelo link, com Câmera e sem 'Cheguei'", async () => {
    await abrirMeuDia();
    expect(estado("aB")).toBe("em-andamento");
    expect(acoes("aB")).toEqual(["Câmera", "Como chegar"]);
    expect(botao("CHEGOU", "aB")).toBeNull();
    await clicar(corpo("aB"));
    await esperarAte(() => vista() === "os", "abriu a OS");
    expect(window.location.search).toBe("?ver=os&a=aB");
    expect(enviadas).toEqual([]); // entrar não registra chegada nem avisa
    expect($("[data-aviso-cliente]")).toBeNull(); // sem toque hoje: nada a registrar
    await reabrir(undefined, "/tecnico?ver=os&a=aB");
    expect(vista()).toBe("os");
  });

  it("OS que o técnico começou no aparelho (1ª gravação ainda a enviar): já conta como em andamento", async () => {
    await guardarNoAparelho();
    online = false;
    await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }]);
    await abrirMeuDia();
    expect(estado()).toBe("em-andamento");
    expect(botao("CHEGOU")).toBeNull();
  });

  it("OS concluída: abre para leitura, sem Câmera nem 'Cheguei'", async () => {
    await abrirMeuDia();
    expect(estado("aC")).toBe("concluida");
    expect(acoes("aC")).toEqual(["Como chegar"]);
    await clicar(corpo("aC"));
    await esperarAte(() => vista() === "os", "abriu a OS");
    expect(texto()).toContain("Atividade concluída");
  });

  it("'Cheguei' de ONTEM não vale hoje numa OS que segue agendada: o card volta a pedir (um toque por dia)", async () => {
    const ontem = { A_CAMINHO: { em: new Date(MEIO_DIA - 26 * 60 * MIN).toISOString(), status: "ENVIADO" as const }, CHEGOU: { em: new Date(MEIO_DIA - 25 * 60 * MIN).toISOString(), status: "ENVIADO" as const } };
    ajustarCartao = (c) => (c.atividadeId === "aA" ? { ...c, avisos: ontem } : c); // o aparelho ainda guarda o de ontem
    await abrirMeuDia();
    expect(estado()).toBe("antes");
    expect(acoes()).toEqual(["Como chegar", "Cheguei", "Avisar que estou a caminho"]);
    await reabrir(undefined, "/tecnico?ver=os&a=aA");
    expect(vista()).toBe("os-antes-de-chegar");
  });
});

/* ═════════════════════════ outro dia ═════════════════════════ */
describe("OS marcada para OUTRO dia (Agenda): o toque avisaria o cliente — confirma antes", () => {
  it("'Cheguei' pergunta; cancelar não grava nada; confirmar registra e entra. A de hoje não pergunta", async () => {
    await abrirApp(undefined, "/tecnico?ver=agenda");
    await esperarAte(() => $$("[data-cartao]").length === 2, "agenda");
    await clicar(botao("CHEGOU", "aD"));
    expect(texto($("[data-confirmacao]"))).toContain("OS agendada para 13/11");
    expect(texto($("[data-confirmacao]"))).toContain("Registrar a chegada agora?");
    await clicar($("[data-confirmar-nao]"));
    expect(await banco.fila()).toEqual([]);
    expect(vista()).toBe("agenda");

    await clicar(botao("CHEGOU", "aD"));
    await clicar($("[data-confirmar-sim]"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(window.location.search).toBe("?ver=os&a=aD");
    expect(avisosEnviados().map((o) => o.atividadeId)).toEqual(["aD"]);
  });

  it("'A caminho' de outro dia também pergunta; a OS de hoje vai direto", async () => {
    await abrirApp(undefined, "/tecnico?ver=agenda");
    await esperarAte(() => $$("[data-cartao]").length === 2, "agenda");
    await clicar(botao("A_CAMINHO", "aD"));
    expect(texto($("[data-confirmacao]"))).toContain("Avisar o cliente agora?");
    await clicar($("[data-confirmar-nao]"));
    expect(await banco.fila()).toEqual([]);
    await clicar(botao("A_CAMINHO", "aA"));
    expect($("[data-confirmacao]")).toBeNull();
    await esperarAte(() => avisosEnviados().length === 1, "a caminho de hoje enviado");
  });
});

/* ═════════════════════════ WhatsApp ═════════════════════════ */
describe("WhatsApp: sem integração de envio, um toque abre a conversa com a mensagem pronta", () => {
  const link = () => $<HTMLAnchorElement>("[data-aviso-whatsapp]");
  const mensagem = () => decodeURIComponent(link()!.href.split("?text=")[1]);

  it("no card, depois de 'A caminho'; na OS, depois de 'Cheguei' — em nova aba, com 44 px", async () => {
    await abrirMeuDia();
    expect(link()).toBeNull(); // só aparece depois do toque
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => !!link(), "link do WhatsApp");
    expect(link()!.href.startsWith("https://wa.me/5511966665555?text=")).toBe(true);
    expect(mensagem()).toBe("Clima Total: nosso técnico está a caminho do seu atendimento.");
    expect(link()!.target).toBe("_blank");
    expect(link()!.rel).toContain("noopener");
    expect(link()!.className).toContain("touch-target");
    expect(link()!.getAttribute("aria-label")).toBe("Avisar pelo WhatsApp");
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os" && !!link(), "na OS");
    expect(mensagem()).toBe("Clima Total: nosso técnico chegou ao local.");
    expect(texto(link())).toBe("Avisar pelo WhatsApp (chegada)");
    expect(link()!.className).toContain("touch-target");
  });

  it("'Exibir contatos do cliente' DESLIGADO: sem toque de WhatsApp (mesmo com número num retrato antigo no aparelho)", async () => {
    await abrirMeuDia({ ...CONFIG_APP_PADRAO, exibirContatosCliente: false });
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(link()).toBeNull();
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os" && registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "na OS");
    expect(link()).toBeNull();
    expect(document.body.innerHTML).not.toContain("96666");
  });

  it("cliente sem WhatsApp no cadastro: sem o toque; o e-mail segue normal", async () => {
    ajustar = (r) => ({ ...r, avisoCliente: { empresa: "Clima Total", whatsapp: null } });
    await abrirMeuDia();
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(link()).toBeNull();
  });
});

/* ═════════════════════════ permissões ═════════════════════════ */
describe("respeita as permissões do app do colaborador", () => {
  it("'Avisar o cliente' DESLIGADO: sem 'A caminho'; o 'Cheguei' continua sendo a porta — registra o horário e abre a OS, sem falar em aviso", async () => {
    servidor.ligado = false;
    const semAviso = { ...CONFIG_APP_PADRAO, avisarCliente: false };
    await guardarNoAparelho();
    online = false; // nem sem sinal fala em aviso
    await abrirMeuDia(semAviso);
    expect(acoes()).toEqual(["Como chegar", "Cheguei"]);
    expect(texto()).not.toContain("a caminho");
    await clicar(corpo());
    expect(texto(card()!.querySelector("[data-dica-cheguei]"))).toBe("“Cheguei” registra o horário e abre a OS.");
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(toasts()).toEqual([]);
    expect(dito("CHEGOU")).toBe("Cheguei · registrado às 12:00");
    await voltarOSinal();
    await esperarAte(() => registro("CHEGOU")?.dataset.avisoFeito === "INDISPONIVEL", "horário registrado");
    expect(dito("CHEGOU")).toBe("Cheguei · registrado às 12:00");
    expect($("[data-aviso-whatsapp]")).toBeNull();
    expect(enviadas.map((o) => [o.tipo, o.dados?.evento])).toEqual([["avisoCliente", "CHEGOU"]]);
  });

  it("'Exibir dados do cliente' DESLIGADO: 'A caminho' e 'Cheguei' funcionam e nada do cliente aparece no card, na OS nem no recado ao técnico", async () => {
    const semDados = { ...CONFIG_APP_PADRAO, exibirDadosCliente: false, exibirContatosCliente: false };
    ajustarCartao = (c) => aplicarPrivacidade(c, semDados);
    ajustar = (r) => ({ ...r, avisoCliente: { empresa: "Clima Total", whatsapp: null } });
    await abrirMeuDia(semDados);
    await clicar(botao("A_CAMINHO"));
    await esperarAte(() => registro("A_CAMINHO")?.dataset.avisoFeito === "ENVIADO", "avisado");
    expect(dito("A_CAMINHO")).toBe("A caminho · avisado às 12:00");
    await clicar(botao("CHEGOU"));
    await esperarAte(() => vista() === "os" && registro("CHEGOU")?.dataset.avisoFeito === "ENVIADO", "na OS");
    for (const dado of ["Hospital Santa Luzia", "Av. Paulista", "Marta"]) expect(texto(), dado).not.toContain(dado);
    expect(document.body.innerHTML).not.toMatch(/@|wa\.me/);
    expect(recados.join(" ")).not.toMatch(/@|Hospital/);
  });
});

/* ═════════════════════════ regras puras ═════════════════════════ */
describe("regras puras", () => {
  const AGORA = MEIO_DIA;
  const em = (min: number) => new Date(AGORA + min * MIN).toISOString();
  const c = (extra: Partial<CartaoTela> = {}) => ({ atividadeId: "aA", status: "AGENDADA", ...extra }) as CartaoTela;
  const op = (tipo: string, extra: Record<string, unknown> = {}) => ({ id: tipo, atividadeId: "aA", tipo, criadoEm: em(0), em: em(0), estado: "pendente", tentativas: 0, ...extra }) as unknown as OperacaoFila;

  it("os estados do card e a porta da OS: agendada só entra com o 'Cheguei' de HOJE", () => {
    const cheguei = { CHEGOU: { em: em(-10), status: "ENVIADO" as const } };
    const aCaminho = { A_CAMINHO: { em: em(-10), status: "ENVIADO" as const } };
    const ontem = { CHEGOU: { em: em(-25 * 60), status: "ENVIADO" as const } };
    expect([estadoDoCartao("AGENDADA", {}, AGORA), estadoDoCartao("AGENDADA", aCaminho, AGORA), estadoDoCartao("AGENDADA", cheguei, AGORA), estadoDoCartao("AGENDADA", { ...aCaminho, ...cheguei }, AGORA)])
      .toEqual(["antes", "a-caminho", "chegou", "chegou"]);
    expect([estadoDoCartao("EM_ANDAMENTO", {}, AGORA), estadoDoCartao("CONCLUIDA", cheguei, AGORA), estadoDoCartao("CANCELADA", {}, AGORA), estadoDoCartao("AGENDADA", ontem, AGORA)])
      .toEqual(["em-andamento", "concluida", "cancelada", "antes"]);
    expect([podeEntrar("AGENDADA", {}, AGORA), podeEntrar("AGENDADA", undefined, AGORA), podeEntrar("AGENDADA", aCaminho, AGORA), podeEntrar("AGENDADA", ontem, AGORA)]).toEqual([false, false, false, false]);
    expect([podeEntrar("AGENDADA", cheguei, AGORA), podeEntrar("EM_ANDAMENTO", {}, AGORA), podeEntrar("CONCLUIDA", {}, AGORA), podeEntrar("CANCELADA", {}, AGORA)]).toEqual([true, true, true, true]);
  });

  it("situação do card = lista + OS guardada (se mais nova) + o que está no aparelho", () => {
    const s = (cartaoDoDia: CartaoTela, fila: OperacaoFila[] = [], op2: Parameters<typeof situacaoDoCartao>[2] = {}) => situacaoDoCartao(cartaoDoDia, fila, { agora: AGORA, ...op2 });
    expect(s(c())).toMatchObject({ status: "AGENDADA", estado: "antes", entra: false, aEnviar: 0 });
    // o toque no aparelho vale na hora — pendente ou já enviado (à espera do retrato novo)
    expect(s(c(), [op("avisoCliente", { dados: { evento: "A_CAMINHO" } })])).toMatchObject({ estado: "a-caminho", entra: false, aEnviar: 1 });
    expect(s(c(), [op("avisoCliente", { dados: { evento: "CHEGOU" }, estado: "enviada" })])).toMatchObject({ estado: "chegou", entra: true, aEnviar: 0 });
    // de outra atividade não conta
    expect(s(c(), [op("avisoCliente", { atividadeId: "aZ", dados: { evento: "CHEGOU" } })]).estado).toBe("antes");
    // a lista já sabe (outro aparelho)
    expect(s(c({ avisos: { CHEGOU: { em: em(-5), status: "ENVIADO" } } })).estado).toBe("chegou");
    // a OS guardada sabe o que a lista antiga não sabe: a chegada sempre; a situação só se for mais nova que a lista
    const guardado = { status: "EM_ANDAMENTO", avisos: { CHEGOU: { em: em(-5), status: "ENVIADO" as const } }, salvoEm: 200 };
    expect(s(c(), [], { guardado: { ...guardado, status: "AGENDADA" }, listaEm: 300 }).estado).toBe("chegou");
    expect(s(c(), [], { guardado, listaEm: 100 })).toMatchObject({ status: "EM_ANDAMENTO", estado: "em-andamento" });
    expect(s(c({ status: "CONCLUIDA" }), [], { guardado, listaEm: 300 }).status).toBe("CONCLUIDA"); // a lista é mais nova: vale ela
    expect(s(c(), [], { guardado }).status).toBe("EM_ANDAMENTO"); // sem lista (dentro da OS): vale a OS guardada
    // iniciar/concluir ainda a enviar
    expect(s(c(), [op("iniciar")])).toMatchObject({ status: "EM_ANDAMENTO", estado: "em-andamento", entra: true });
    expect(s(c(), [op("concluir")]).estado).toBe("concluida");
  });

  it("um toque por evento, por dia; ao juntar as fontes vale o que o servidor já respondeu", () => {
    const base = { A_CAMINHO: { em: em(-30), status: "ENVIADO" as const } };
    expect(aplicarToque(base, "A_CAMINHO", em(0))).toBe(base); // repetido hoje: nada muda
    expect(aplicarToque(base, "CHEGOU", em(0))).toEqual({ ...base, CHEGOU: { em: em(0), status: null, pendente: true } });
    expect(aplicarToque({ CHEGOU: { em: em(-25 * 60), status: "ENVIADO" } }, "CHEGOU", em(0)).CHEGOU).toEqual({ em: em(0), status: null, pendente: true }); // ontem não conta
    expect(aplicarToque(undefined, "CHEGOU", em(0))).toEqual({ CHEGOU: { em: em(0), status: null, pendente: true } });
    const doAparelho = { CHEGOU: { em: em(0), status: null } };
    const doServidor = { CHEGOU: { em: em(0), status: "ENVIADO" as const } };
    expect(juntarAvisos(doAparelho, doServidor)).toEqual(doServidor);
    expect(juntarAvisos(undefined, null, doAparelho, base)).toEqual({ ...doAparelho, ...base });
    expect(juntarAvisos()).toEqual({});
  });

  it("com o aviso desligado na empresa o registro só diz o horário", () => {
    expect(rotuloAviso("CHEGOU", { em: em(0), status: "INDISPONIVEL" }, AGORA, false)).toMatchObject({ texto: "Cheguei · registrado às 12:00", tom: "neutro" });
    expect(rotuloAviso("CHEGOU", { em: em(0), status: null }, AGORA, false).texto).toBe("Cheguei · registrado às 12:00");
    expect(rotuloAviso("CHEGOU", { em: em(0), status: "ENVIADO" }, AGORA).texto).toBe("Cheguei · avisado às 12:00");
  });

  it("descrição para o app: o texto do serviço fica sempre; a identidade de quem pediu sai conforme as chaves", () => {
    const tudo = { exibirDadosCliente: true, exibirContatosCliente: true };
    const semContato = { exibirDadosCliente: true, exibirContatosCliente: false };
    const semDados = { exibirDadosCliente: false, exibirContatosCliente: true };
    const doQr = `${PEDIDO}\n\n${RODAPE}`;
    expect(descricaoParaApp(doQr, tudo)).toBe(doQr);
    expect(descricaoParaApp(doQr, semDados)).toBe(PEDIDO);
    expect(descricaoParaApp(doQr, { exibirDadosCliente: false, exibirContatosCliente: false })).toBe(PEDIDO);
    expect(descricaoParaApp(doQr, semContato)).toBe(`${PEDIDO}\n\nSolicitante: Marta Lima`);
    const orcamento = "Solicitação de orçamento. Trocar 3 splits.\n\n[Orçamento via QR Code] Solicitante: Rui · Telefone: 11 90000-0000";
    expect(descricaoParaApp(orcamento, semDados)).toBe("Solicitação de orçamento. Trocar 3 splits.");
    // sem rodapé (OS do escritório, chamado do portal): o texto vai como está
    for (const cfg of [tudo, semContato, semDados]) expect(descricaoParaApp("[Vazamento] Pinga na sala 2", cfg)).toBe("[Vazamento] Pinga na sala 2");
    expect([descricaoParaApp(null, tudo), descricaoParaApp(undefined, semDados), descricaoParaApp("  ", tudo)]).toEqual(["", "", ""]);
    // no cartão: a orientação do escritório não é dado do cliente — fica
    const cartaoDoServidor = { cliente: "Hospital", telefone: "11", unidade: "Matriz", endereco: "Rua A", rota: "https://maps", descricao: doQr, orientacao: ORIENTACAO };
    expect(aplicarPrivacidade(cartaoDoServidor, semDados)).toEqual({ cliente: "", telefone: "11", unidade: null, endereco: "", rota: null, descricao: PEDIDO, orientacao: ORIENTACAO });
  });
});
