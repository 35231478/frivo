// @vitest-environment happy-dom
/**
 * App de campo, leva 1 (PR 2) — a TELA, num DOM de verdade, com o banco do aparelho e o motor reais:
 *  - aviso de atividade esquecida no Meu dia e na OS (limite, fim do expediente, outro dia), sem sinal também;
 *  - concluir com tempo suspeito: término sugerido (última gravação, do servidor ou do aparelho), confirmar em
 *    1 toque, "agora" ou outro horário validado; sem suspeita, nada muda (2 toques);
 *  - o topo da OS: o que fazer, equipamentos, ligar/WhatsApp/rota em 1 toque; o dado de escritório em "Detalhes";
 *  - Equipes › App do colaborador: o limite de horas.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { JORNADA_PADRAO } from "@/lib/atendimento/prazo";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));

/** Brasília (UTC−3) */
const br = (s: string) => Date.parse(`${s.replace(" ", "T")}:00-03:00`);
const HOJE = "2026-11-12"; // quinta-feira
const H = 3_600_000;
let online = true;
let enviadas: any[] = [];
let status: Record<string, string> = {};
let iniciadas: Record<string, string | null> = {};
let ultimaGravacao: string | null = null;
let limite = 4;
let contatos = true;
let chamado = true;

const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = { id: "eqA", titulo: "Split Sala 1", descricao: "Split Sala 1", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } };
function cartao(id: string): CartaoTela {
  return {
    atividadeId: id, osId: `os-${id}`, osNumero: `OS-${id}`, titulo: "Preventiva", tipoOs: { nome: "Manutenção preventiva", cor: "#000" }, status: status[id], prioridade: id === "aA" ? "URGENTE" : "NORMAL",
    dataAgendada: null, dia: HOJE, hora: "09:00", duracaoMin: 60, cliente: "Hospital Santa Luzia", telefone: contatos ? "(11) 3333-0000" : null, unidade: "Matriz",
    endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: "https://www.google.com/maps/dir/?api=1&destination=x", descricao: "Ar da recepção pingando no balcão.", chamado,
    orientacao: "Levar bomba de dreno.", equipamentos: 1, atendidos: 1, adicionais: 0, avisos: {}, iniciadaEm: iniciadas[id] ?? null, criadoPor: "Ana Escritório", origem: chamado ? "PORTAL_CLIENTE" : "MANUAL",
  } as CartaoTela;
}
function retrato(id: string): RetratoAtividade {
  return {
    cartao: cartao(id),
    execucao: {
      atividade: { id, titulo: "Preventiva", status: status[id], tipoOs: { id: "t", nome: "Manutenção preventiva", cor: "#000" } },
      os: { id: `os-${id}`, numero: `OS-${id}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: status[id] === "CONCLUIDA", adicionais: [], avisos: {}, materiais: [],
      equipamentos: [{ vinculoId: "v1", feito: true, observacao: null, equipamento: info, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: true }],
      conclusao: { ok: true, semEquipamento: false, pendencias: [], atendidos: 1, naoAtendidos: 0, mensagem: null, dispensa: null },
    },
    equipamentosUnidade: [{ ...info, tipoEquipamentoId: "te1", qr: null }], checklistsPorTipo: {}, cadastro: null, avisoCliente: null,
    andamento: { limiteHoras: limite, jornada: JORNADA_PADRAO, ultimaGravacaoEm: ultimaGravacao },
    whatsapp: contatos ? "(11) 96666-5555" : null,
    geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: HOJE, atividades: ["aA", "aB"].map(cartao), anteriores: [], andamento: { limiteHoras: limite, jornada: JORNADA_PADRAO } });
  if (url === "/api/tecnico/catalogo") return json({ produtos: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    for (const o of corpo.operacoes) if (o.tipo === "concluir") status[o.atividadeId] = "CONCLUIDA";
    return json({ resultados: corpo.operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  if (url === "/api/configuracoes") { enviadas.push({ tipo: "PUT /api/configuracoes", corpo: JSON.parse(String(init!.body)) }); return json({}); }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/ui/avisos"), import("@/components/equipes/app-colaborador-client")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(br(`${HOJE} 15:00`));
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; status = { aA: "EM_ANDAMENTO", aB: "AGENDADA" }; iniciadas = { aA: new Date(br(`${HOJE} 09:30`)).toISOString(), aB: null };
  ultimaGravacao = new Date(br(`${HOJE} 11:40`)).toISOString(); limite = 4; contatos = true; chamado = true;
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  window.history.replaceState(null, "", "/tecnico");
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
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
const digitar = async (el: HTMLInputElement | null, valor: string) => {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor); el!.dispatchEvent(new Event("input", { bubbles: true })); el!.dispatchEvent(new Event("change", { bubbles: true })); });
  await esperar();
};
const gravadas = async (tipo: string) => {
  const todas = [...(await banco.fila()).filter((o) => o.tipo === tipo), ...enviadas.filter((o) => o.tipo === tipo)];
  return todas.filter((o, i) => todas.findIndex((x) => x.id === o.id) === i) as any[];
};

async function abrirApp(endereco = "/tecnico", config: Record<string, unknown> = {}) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { Avisos } = await import("@/components/ui/avisos");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e });
    return createElement(MeuDia);
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config: { ...CONFIG_APP_PADRAO, ...config } as never, motorPronto: motor, children: [createElement(Avisos, { key: "a" }), createElement(Vistas, { key: "v" })] })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela carregada");
  await esperar();
}
const abrirOs = async (config: Record<string, unknown> = {}) => { await abrirApp("/tecnico?ver=os&a=aA", config); await esperarAte(() => !!$("[data-topo-os]"), "topo da OS"); };

/* ═════════════════════ atividade esquecida ═════════════════════ */
describe("aviso de atividade esquecida em andamento", () => {
  it("Meu dia: em andamento há mais do limite → faixa com a OS; a agendada não; um toque abre a OS", async () => {
    await abrirApp();
    await esperarAte(() => $$("[data-cartao]").length === 2, "cards");
    const f = $$("[data-aviso-andamento]");
    expect(f).toHaveLength(1);
    expect(f[0].getAttribute("data-aviso-andamento")).toBe("limite");
    expect([...f[0].querySelectorAll("span span")].map((e) => texto(e))).toEqual(["OS-aA · Hospital Santa Luzia", "Em andamento há 5 h 30 min."]);
    await clicar(f[0]);
    await esperarAte(() => window.location.search === "?ver=os&a=aA", "abriu a OS");
  });
  it("antes do limite: nada; limite da empresa (6 h) vale", async () => {
    limite = 6;
    await abrirApp();
    await esperarAte(() => $$("[data-cartao]").length === 2, "cards");
    expect($("[data-aviso-andamento]")).toBeNull();
  });
  it("fim do expediente: avisa mesmo antes do limite (18h na jornada padrão)", async () => {
    vi.setSystemTime(br(`${HOJE} 18:05`));
    iniciadas.aA = new Date(br(`${HOJE} 16:00`)).toISOString();
    await abrirApp();
    await esperarAte(() => !!$("[data-aviso-andamento]"), "faixa");
    expect($("[data-aviso-andamento]")!.getAttribute("data-aviso-andamento")).toBe("fim-do-dia");
    expect(texto($("[data-aviso-andamento]"))).toContain("Expediente encerrado. Em andamento há 2 h 5 min.");
  });
  it("na OS: a faixa fica no topo; começou em outro dia", async () => {
    iniciadas.aA = new Date(br("2026-11-11 16:00")).toISOString();
    await abrirOs();
    expect($("[data-vista='os'] [data-aviso-andamento='outro-dia']")).toBeTruthy();
    expect(texto($("[data-aviso-andamento]"))).toBe("Começou em outro dia e continua em andamento.");
  });
  it("sem sinal também: a OS iniciada no aparelho (ainda na fila) conta pela hora do toque", async () => {
    status.aA = "AGENDADA"; iniciadas.aA = null;
    vi.setSystemTime(br(`${HOJE} 09:00`));
    await abrirApp();
    await esperarAte(() => $$("[data-cartao]").length === 2, "cards");
    online = false;
    await act(async () => { await motor.registrar([{ tipo: "iniciar", atividadeId: "aA" }]); });
    vi.setSystemTime(br(`${HOJE} 13:30`));
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirApp();
    await esperarAte(() => !!$("[data-aviso-andamento='limite']"), "faixa a partir do toque no aparelho");
    expect(texto($("[data-aviso-andamento]"))).toContain("Em andamento há 4 h 30 min.");
  });
});

/* ═════════════════════ concluir com tempo suspeito ═════════════════════ */
describe("concluir com tempo suspeito", () => {
  it("sugere a última gravação, marcada; 'Concluir' em 1 toque grava o término", async () => {
    await abrirOs();
    await clicar($("[data-concluir-atividade]"));
    await esperarAte(() => !!$("[data-termino]"), "bloco do término");
    expect($('[data-opcao-termino="sugerido"]')!.getAttribute("aria-checked")).toBe("true");
    expect(texto($('[data-opcao-termino="sugerido"]'))).toBe("11:40 · última gravação");
    expect(texto($('[data-opcao-termino="agora"]'))).toBe("15:00 · agora");
    await clicar($("[data-confirmar-conclusao]"));
    const [c] = await gravadas("concluir");
    expect(c.dados).toEqual({ terminoEm: new Date(br(`${HOJE} 11:40`)).toISOString() });
  });
  it("'agora': conclui sem término informado", async () => {
    await abrirOs();
    await clicar($("[data-concluir-atividade]"));
    await clicar($('[data-opcao-termino="agora"]'));
    await clicar($("[data-confirmar-conclusao]"));
    expect((await gravadas("concluir"))[0].dados).toEqual({});
  });
  it("outro horário: fora do intervalo trava o botão com o motivo; dentro, vale", async () => {
    await abrirOs();
    await clicar($("[data-concluir-atividade]"));
    await clicar($('[data-opcao-termino="outro"]'));
    await digitar($("[data-termino-outro]") as HTMLInputElement, "08:00"); // antes do início (09:30)
    expect(($("[data-confirmar-conclusao]") as HTMLButtonElement).disabled).toBe(true);
    expect(texto($("[data-termino-invalido]"))).toBe("O horário de término precisa ficar entre o início da atividade e agora.");
    await digitar($("[data-termino-outro]") as HTMLInputElement, "16:00"); // depois de agora (15:00)
    expect(($("[data-confirmar-conclusao]") as HTMLButtonElement).disabled).toBe(true);
    await digitar($("[data-termino-outro]") as HTMLInputElement, "12:15");
    expect(($("[data-confirmar-conclusao]") as HTMLButtonElement).disabled).toBe(false);
    await clicar($("[data-confirmar-conclusao]"));
    expect((await gravadas("concluir"))[0].dados.terminoEm).toBe(new Date(br(`${HOJE} 12:15`)).toISOString());
  });
  it("a gravação feita no aparelho depois da do servidor vira a sugestão", async () => {
    await abrirOs();
    vi.setSystemTime(br(`${HOJE} 14:10`));
    online = false;
    await act(async () => { await motor.registrar([{ tipo: "equipamento", atividadeId: "aA", equipamentoId: "eqA", dados: { observacao: "ok" } }]); });
    vi.setSystemTime(br(`${HOJE} 15:00`));
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirOs();
    await clicar($("[data-concluir-atividade]"));
    expect(texto($('[data-opcao-termino="sugerido"]'))).toBe("14:10 · última gravação");
  });
  it("sem gravação no intervalo: sem sugestão — começa em 'Outro horário'", async () => {
    ultimaGravacao = null;
    await abrirOs();
    await clicar($("[data-concluir-atividade]"));
    expect($('[data-opcao-termino="sugerido"]')).toBeNull();
    expect($('[data-opcao-termino="outro"]')!.getAttribute("aria-checked")).toBe("true");
    expect(($("[data-confirmar-conclusao]") as HTMLButtonElement).disabled).toBe(true);
  });
  it("sem suspeita: nada muda — Concluir e confirmar (2 toques), sem término", async () => {
    iniciadas.aA = new Date(br(`${HOJE} 13:00`)).toISOString();
    await abrirOs();
    expect($("[data-aviso-andamento]")).toBeNull();
    await clicar($("[data-concluir-atividade]"));
    expect($("[data-termino]")).toBeNull();
    await clicar($("[data-confirmar-conclusao]"));
    expect((await gravadas("concluir"))[0].dados).toEqual({});
  });
});

/* ═════════════════════ o topo da OS ═════════════════════ */
describe("topo da OS: o que fazer", () => {
  it("problema relatado, equipamentos, endereço; ligar, WhatsApp e rota em 1 toque; prioridade alta em destaque", async () => {
    await abrirOs();
    const t = $("[data-topo-os]")!;
    expect(texto(t.querySelector("[data-problema] h2"))).toBe("Problema relatado");
    expect(texto(t.querySelector("[data-problema] p"))).toBe("Ar da recepção pingando no balcão.");
    expect(texto(t.querySelector("[data-resumo-equipamentos]"))).toBe("1 equipamento · 1 atendido");
    expect(texto(t.querySelector("[data-endereco-topo]"))).toBe("Av. Paulista, 1000 — São Paulo/SP");
    expect(t.querySelector("[data-ligar]")!.getAttribute("href")).toBe("tel:1133330000");
    expect(t.querySelector("[data-whatsapp-topo]")!.getAttribute("href")).toBe("https://wa.me/5511966665555");
    expect(t.querySelector("[data-rota]")).toBeTruthy();
    expect(texto(t.querySelector("[data-prioridade-topo]"))).toBe("Urgente");
    // O dado de escritório NÃO está no topo; está em "Detalhes"
    const fora = texto(t).replace(texto(t.querySelector("[data-detalhes-os]")), "");
    expect(fora).not.toContain("Ana Escritório");
    expect(fora).not.toContain("Levar bomba de dreno");
  });
  it("'Detalhes': quem abriu, como chegou, orientação do escritório", async () => {
    await abrirOs();
    const pares = Object.fromEntries($$("[data-detalhes-os] [data-detalhe]").map((e) => [texto(e.querySelector("dt")), texto(e.querySelector("dd"))]));
    expect(pares).toMatchObject({ "Aberta por": "Ana Escritório", Origem: "Chamado do cliente", "Orientação do escritório": "Levar bomba de dreno.", Horário: "09:00 · 60 min", Prioridade: "Urgente" });
  });
  it("OS do escritório: 'O que fazer'; sem contatos: sem ligar e sem WhatsApp; sem dados do cliente: sem rota nem endereço", async () => {
    chamado = false; contatos = false;
    await abrirOs({ exibirContatosCliente: false, exibirDadosCliente: false });
    const t = $("[data-topo-os]")!;
    expect(texto(t.querySelector("[data-problema] h2"))).toBe("O que fazer");
    expect(t.querySelector("[data-ligar]")).toBeNull();
    expect(t.querySelector("[data-whatsapp-topo]")).toBeNull();
    expect(t.querySelector("[data-rota]")).toBeNull();
    expect(t.querySelector("[data-endereco-topo]")).toBeNull();
    expect(texto(t.querySelector("[data-detalhes-os]"))).not.toContain("Matriz");
  });
  it("sem texto explicativo na tela: as explicações ficam na dica (ⓘ)", async () => {
    await abrirOs();
    const tudo = texto($("[data-vista='os']"));
    expect(tudo).not.toContain("Fotografe à vontade");
    expect(tudo).not.toContain("Cada foto vai com o equipamento");
    expect($('[aria-label="Ajuda: Câmera rápida"], button[aria-label*="Câmera rápida"]')).toBeTruthy();
  });
});

/* ═════════════════════ configuração ═════════════════════ */
describe("Equipes › App do colaborador: limite de horas", () => {
  async function montar(inicial = CONFIG_APP_PADRAO) {
    const { AppColaboradorClient } = await import("@/components/equipes/app-colaborador-client");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(AppColaboradorClient, { inicial })); });
    await esperar();
  }
  it("mostra o valor; fora de 1 a 24 trava o salvar com o motivo; válido vai no PUT", async () => {
    await montar({ ...CONFIG_APP_PADRAO, alertaAndamentoHoras: 4 });
    const campo = $("[data-alerta-horas]") as HTMLInputElement;
    expect(campo.value).toBe("4");
    await digitar(campo, "0");
    expect(($("[data-salvar]") as HTMLButtonElement).disabled).toBe(true);
    expect(texto($("[data-alerta-horas-invalido]"))).toBe("Use de 1 a 24 horas.");
    await digitar(campo, "25");
    expect(($("[data-salvar]") as HTMLButtonElement).disabled).toBe(true);
    await digitar(campo, "6");
    expect($("[data-alerta-horas-invalido]")).toBeNull();
    await clicar($("[data-salvar]"));
    await esperarAte(() => enviadas.some((e) => e.tipo === "PUT /api/configuracoes"), "PUT");
    expect(enviadas.find((e) => e.tipo === "PUT /api/configuracoes").corpo.appAlertaAndamentoHoras).toBe(6);
  });
});
