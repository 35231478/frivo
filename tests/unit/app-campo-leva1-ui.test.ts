// @vitest-environment happy-dom
/**
 * App de campo, leva 1 — a TELA do app do técnico num DOM de verdade, com o banco do aparelho de verdade
 * (IndexedDB via fake-indexeddb), o motor de sincronização real e as vistas trocando pela URL. Servidor simulado.
 *  - "Ler QR do equipamento" no Meu dia: equipamento na OS de hoje abre nele; da unidade pergunta antes de incluir
 *    (e grava o vínculo com origem QR); fora de tudo abre a ficha (sem sinal: avisa e fica); OS ainda não chegada:
 *    o "Cheguei" abre direto no equipamento lido;
 *  - Materiais usados: um lugar só (equipamento e OS), catálogo do aparelho (sem sinal também), quantidade com
 *    botões grandes, corrigir/remover só o que é dele, nada com a atividade concluída.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { MSG_FICHA_SEM_SINAL } from "@/lib/tecnico/qr-campo";
import { aplicarMaterial, removerMaterialDaLista } from "@/lib/tecnico/materiais";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
// O leitor de QR: um botão que "lê" o valor que o teste escolher
const leitura = vi.hoisted(() => ({ valor: "" }));
vi.mock("@/components/os/scanner-qr", async () => {
  const { createElement: ce } = await import("react");
  return { ScannerQR: ({ onLer }: { onLer: (v: string) => void }) => ce("button", { type: "button", "data-ler-falso": "", onClick: () => onLer(leitura.valor) }, "ler") };
});
const ditos: string[] = [];

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
let enviadas: any[] = [];
let fichas: string[] = [];
let respostaFicha: (valor: string) => { status: number; corpo: unknown } = () => ({ status: 404, corpo: { erro: "QR Code não reconhecido." } });
let status: Record<string, string> = {};
let avisos: Record<string, any> = {};
let materiaisServidor: Record<string, any[]> = {};

const info = (id: string, titulo: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin", tag: `TAG-${id}`, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } });
const UNIDADE = [
  { ...info("eqA", "Split Sala 1"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-A", codigo: "QR-A" } },
  { ...info("eqB", "Split Sala 2"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-B", codigo: "QR-B" } },
  { ...info("eqC", "Split Sala 3"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-C", codigo: "QR-C" } },
];
const VINCULOS: Record<string, string[]> = { aA: ["eqA"], aG: ["eqC"] };
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
function cartao(id: string): CartaoTela {
  return {
    atividadeId: id, osId: `os-${id}`, osNumero: `OS-${id}`, titulo: "Preventiva", tipoOs: null, status: status[id], prioridade: "NORMAL",
    dataAgendada: null, dia: HOJE, hora: id === "aA" ? "09:00" : "14:00", duracaoMin: 60, cliente: "Hospital Santa Luzia", telefone: null, unidade: "Matriz",
    endereco: "Av. Paulista, 1000", rota: null, descricao: "Preventiva mensal", equipamentos: VINCULOS[id].length, atendidos: 0, adicionais: 0, avisos: { ...avisos[id] },
  } as CartaoTela;
}
function retrato(id: string): RetratoAtividade {
  return {
    cartao: cartao(id),
    execucao: {
      atividade: { id, titulo: "Preventiva", status: status[id], tipoOs: null }, os: { id: `os-${id}`, numero: `OS-${id}`, status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: status[id] === "CONCLUIDA", adicionais: [], avisos: { ...avisos[id] }, materiais: materiaisServidor[id] ?? [],
      equipamentos: VINCULOS[id].map((e) => ({ vinculoId: `v-${e}`, feito: false, observacao: null, equipamento: info(e, UNIDADE.find((u) => u.id === e)!.titulo), itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false })),
      conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
    },
    equipamentosUnidade: UNIDADE, checklistsPorTipo: {}, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
  } as unknown as RetratoAtividade;
}
const CATALOGO = [
  { id: "pCap", codigo: 104, nome: "Capacitor 35 µF", unidade: "un" },
  { id: "pCabo", codigo: 115, nome: "Cabo PP 2,5 mm²", unidade: "m" },
];
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: HOJE, atividades: ["aA", "aG"].map(cartao), anteriores: [] });
  if (url === "/api/tecnico/catalogo") return json({ produtos: CATALOGO });
  if (url.startsWith("/api/tecnico/equipamentos/qr")) {
    const v = new URL(url, "http://x").searchParams.get("valor")!;
    fichas.push(v);
    const r = respostaFicha(v);
    return json(r.corpo, r.status);
  }
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato(decodeURIComponent(url.split("/").pop()!)));
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    enviadas.push(...corpo.operacoes);
    // O servidor guarda o que recebeu (o retrato seguinte já reflete), com as mesmas regras puras
    for (const o of corpo.operacoes) {
      if (o.tipo === "avisoCliente") avisos[o.atividadeId] = { ...avisos[o.atividadeId], [o.dados.evento]: { em: o.em, status: "ENVIADO" } };
      if (o.tipo === "iniciar" && status[o.atividadeId] === "AGENDADA") status[o.atividadeId] = "EM_ANDAMENTO";
      if (o.tipo === "vincular") VINCULOS[o.atividadeId] = [...new Set([...VINCULOS[o.atividadeId], ...o.equipamentoIds])];
      if (o.tipo === "material") materiaisServidor[o.atividadeId] = aplicarMaterial(materiaisServidor[o.atividadeId] ?? [], o.dados).map((m) => ({ ...m, pendente: undefined, id: m.id ?? `s-${m.clientId}` }));
      if (o.tipo === "materialRemover") materiaisServidor[o.atividadeId] = removerMaterialDaLista(materiaisServidor[o.atividadeId] ?? [], o.dados);
    }
    return json({ resultados: corpo.operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/qr-equipamento"), import("@/components/ui/avisos")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; enviadas = []; fichas = []; ditos.length = 0; leitura.valor = "";
  status = { aA: "EM_ANDAMENTO", aG: "AGENDADA" }; avisos = {}; materiaisServidor = {};
  VINCULOS.aA = ["eqA"]; VINCULOS.aG = ["eqC"];
  respostaFicha = () => ({ status: 404, corpo: { erro: "QR Code não reconhecido." } });
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  window.history.replaceState(null, "", "/tecnico");
  const avisosMod = await import("@/components/ui/avisos");
  vi.spyOn(avisosMod, "toast").mockImplementation((m: string) => { ditos.push(m); });
  vi.spyOn(avisosMod, "confirmar").mockResolvedValue(true);
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
  await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(el, valor); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar();
};
const vista = () => $("[data-vista]")?.getAttribute("data-vista") ?? null;
const url = () => window.location.search;
const naFila = async (tipo?: string) => (await banco.fila()).filter((o) => !tipo || o.tipo === tipo);
/** O que foi gravado: o que ainda está na fila do aparelho + o que já subiu (uma vez cada) */
const gravadas = async (tipo: string) => {
  const todas = [...(await naFila(tipo)), ...enviadas.filter((o) => o.tipo === tipo)];
  return todas.filter((o, i) => todas.findIndex((x) => x.id === o.id) === i) as any[];
};

async function abrirApp(usuario: Record<string, unknown> = {}, endereco = "/tecnico") {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { VistaFichaEquipamento } = await import("@/components/tecnico/qr-equipamento");
  const { Avisos } = await import("@/components/ui/avisos");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    if (v.ver === "os") return createElement(VistaOs, { key: `${v.a}`, atividadeId: v.a, equipamentoId: v.e, camera: v.cam, incluir: v.inc });
    if (v.ver === "equipamento") return createElement(VistaFichaEquipamento, { key: v.q, valor: v.q });
    return createElement(MeuDia);
  }
  window.history.replaceState(null, "", endereco);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: { ...USUARIO, ...usuario } as never, motorPronto: motor, children: [createElement(Avisos, { key: "a" }), createElement(Vistas, { key: "v" })] })); });
  await esperarAte(() => !!$("[data-vista]") && !$("[data-carregando]") && !$(".animate-spin"), "tela carregada");
  await esperar();
}
const abrirMeuDia = async (usuario: Record<string, unknown> = {}) => {
  await abrirApp(usuario);
  await esperarAte(() => $$("[data-cartao]").length === 2, "2 cards");
  // As OS do dia e o catálogo ficam no aparelho (como ao abrir com sinal)
  await act(async () => { await motor.prepararSemSinal(["aA", "aG"]); });
  await esperar();
};
async function lerQr(valor: string) {
  leitura.valor = valor;
  await clicar($("[data-ler-qr-dia]"));
  await clicar($("[data-ler-falso]"));
  await esperar(12);
}

/* ═════════════════════ QR no Meu dia ═════════════════════ */
describe("Ler QR do equipamento (Meu dia)", () => {
  it("o botão está no Meu dia, grande, com texto; some sem o módulo QR Codes", async () => {
    await abrirMeuDia();
    const b = $("[data-ler-qr-dia]")!;
    expect(texto(b)).toBe("Ler QR do equipamento");
    expect(b.className).toContain("touch-target");
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirMeuDia({ qrcodes: false });
    expect($("[data-ler-qr-dia]")).toBeNull();
  });
  it("equipamento na OS de hoje (já no local): abre o equipamento DENTRO da OS — nada gravado", async () => {
    await abrirMeuDia();
    await lerQr("https://app.frivo.com.br/qr/tok-A");
    await esperarAte(() => url().includes("e=eqA"), "abriu o equipamento");
    expect(url()).toBe("?ver=os&a=aA&e=eqA");
    expect($("[data-concluir-equipamento]")).toBeTruthy();
    expect(await naFila()).toHaveLength(0);
    expect(fichas).toEqual([]);
  });
  it("sem sinal também (resolve com as OS guardadas no aparelho)", async () => {
    await abrirMeuDia();
    online = false;
    await lerQr("QR-A");
    await esperarAte(() => url().includes("e=eqA"), "abriu o equipamento sem sinal");
  });
  it("da unidade, fora da atividade: PERGUNTA; 'Agora não' volta à OS sem gravar nada", async () => {
    await abrirMeuDia();
    await lerQr("QR-B");
    await esperarAte(() => !!$("[data-incluir-qr]"), "pergunta de incluir");
    expect(url()).toBe("?ver=os&a=aA&inc=eqB");
    expect(texto($("[data-incluir-qr]"))).toContain("Split Sala 2");
    expect(texto($("[data-incluir-qr]"))).toContain("OS-aA · Preventiva");
    await clicar([...$$("button")].find((b) => texto(b) === "Agora não"));
    await esperarAte(() => !$("[data-incluir-qr]"), "fechou");
    expect(url()).toBe("?ver=os&a=aA");
    expect(await naFila("vincular")).toHaveLength(0);
  });
  it("'Incluir e abrir': grava o vínculo com origem QR (vai para o histórico da OS) e abre o equipamento", async () => {
    await abrirMeuDia();
    await lerQr("QR-B");
    await esperarAte(() => !!$("[data-confirmar-incluir]"), "pergunta");
    await clicar($("[data-confirmar-incluir]"));
    await esperarAte(() => url().includes("e=eqB"), "abriu o incluído");
    const v = await gravadas("vincular");
    expect(v[0]).toMatchObject({ tipo: "vincular", atividadeId: "aA", equipamentoIds: ["eqB"], origem: "qr" });
    expect($("[data-incluir-qr]")).toBeNull();
  });
  it("OS de hoje ainda sem 'Cheguei': mostra o card; o 'Cheguei' abre DIRETO no equipamento lido", async () => {
    await abrirMeuDia();
    await lerQr("QR-C");
    await esperarAte(() => vista() === "os-antes-de-chegar", "trava da chegada");
    expect(url()).toBe("?ver=os&a=aG&e=eqC");
    await clicar($("[data-cheguei]"));
    await esperarAte(() => !!$("[data-concluir-equipamento]"), "abriu o equipamento depois do Cheguei");
    expect(url()).toBe("?ver=os&a=aG&e=eqC");
  });
  it("fora das OS de hoje, com sinal: a FICHA (só leitura, histórico, sem valores)", async () => {
    respostaFicha = () => ({ status: 200, corpo: {
      equipamento: { id: "eqX", titulo: "Cassete recepção", fabricante: "Midea", tag: "PAT-9", numeroSerie: null, local: "Recepção", unidade: "Matriz", cliente: "Clínica Vitta", tipo: "Cassete", ativo: true },
      atividadeHoje: null,
      historico: [{ chave: "h1", data: "2026-10-10T12:00:00Z", titulo: "Preventiva", tipoServico: "Manutenção preventiva", tecnico: "Rafael", status: "CONCLUIDA", checklist: { ok: 12, atencao: 1, naoSeAplica: 0, itensAtencao: ["Dreno"] }, medicoes: [{ texto: "Sucção", valor: 132.5, unidade: "psi" }], observacao: "Filtro trocado", resumo: null, adicionais: ["Troca do controle"], fotos: 2, osNumero: "OS-1284" }],
    } });
    await abrirMeuDia();
    await lerQr("QR-X");
    await esperarAte(() => !!$("[data-ficha]"), "ficha");
    expect(url()).toBe("?ver=equipamento&q=QR-X");
    expect(fichas).toEqual(["QR-X"]);
    const f = texto($("[data-vista='ficha-equipamento']"));
    expect(f).toContain("Cassete recepção");
    expect(f).toContain("Clínica Vitta · Matriz · Recepção");
    expect(f).toContain("12 OK · 1 atenção");
    expect(f).toContain("Sucção: 132,5 psi");
    expect(f).toContain("Adicional: Troca do controle");
    expect(f).not.toMatch(/R\$|valor|custo/i);
    // Nada a gravar numa ficha
    expect($("[data-novo-material]")).toBeNull();
    expect(await naFila()).toHaveLength(0);
  });
  it("a ficha diz que ele está numa OS dele hoje (o aparelho não sabia): abre a OS", async () => {
    respostaFicha = () => ({ status: 200, corpo: { equipamento: { id: "eqA" }, atividadeHoje: { atividadeId: "aA", vinculado: true }, historico: [] } });
    await abrirMeuDia();
    await lerQr("QR-OUTRA-UNIDADE");
    await esperarAte(() => url() === "?ver=os&a=aA&e=eqA", "redirecionou para a OS");
  });
  it("sem sinal e fora das OS de hoje: avisa e FICA no Meu dia (não abre tela vazia)", async () => {
    await abrirMeuDia();
    online = false;
    await lerQr("QR-X");
    expect(ditos).toContain(MSG_FICHA_SEM_SINAL);
    expect(vista()).toBe("dia");
    expect(fichas).toEqual([]);
  });
  it("erro do servidor na ficha: mostra o motivo", async () => {
    respostaFicha = () => ({ status: 403, corpo: { erro: "Sem permissão para Equipamentos." } });
    await abrirMeuDia();
    await lerQr("QR-X");
    await esperarAte(() => !!$("[data-ficha-erro]"), "erro");
    expect(texto($("[data-ficha-erro]"))).toBe("Sem permissão para Equipamentos.");
  });
});

/* ═════════════════════ Materiais usados ═════════════════════ */
const secaoEquip = () => $('[data-materiais="eqA"]');
async function abrirEquipamento() {
  await abrirMeuDia();
  await act(async () => { await motor.baixarLista("catalogo", "/api/tecnico/catalogo"); });
  const { irPara } = await import("@/components/tecnico/contexto");
  await act(async () => { irPara({ ver: "os", a: "aA", e: "eqA" }); });
  await esperarAte(() => !!secaoEquip(), "seção de materiais do equipamento");
}
async function lancar(busca: string, qtd?: string) {
  await clicar(secaoEquip()!.querySelector("[data-novo-material]"));
  await digitar($("[data-busca-material]"), busca);
  await clicar($("[data-produto]"));
  if (qtd !== undefined) await digitar($("[data-qtd-material]"), qtd);
  await clicar($("[data-salvar-material]"));
}

describe("Materiais usados", () => {
  it("no equipamento e na OS: um lugar só, com o mesmo botão", async () => {
    await abrirEquipamento();
    expect(texto(secaoEquip())).toContain("Materiais usados");
    expect(texto(secaoEquip())).toContain("Adicionar material");
    const { irPara } = await import("@/components/tecnico/contexto");
    await act(async () => { irPara({ ver: "os", a: "aA" }); });
    await esperarAte(() => !!$('[data-materiais="atividade"]'), "seção da OS");
  });
  it("busca no catálogo do aparelho, SEM SINAL; quantidade com − e +; grava no aparelho com o nome e a unidade", async () => {
    await abrirEquipamento();
    online = false;
    await clicar(secaoEquip()!.querySelector("[data-novo-material]"));
    await digitar($("[data-busca-material]"), "capac");
    expect($$("[data-produto]").map((b) => b.getAttribute("data-produto"))).toEqual(["pCap"]);
    expect(texto($("[data-resultados-material]"))).not.toMatch(/R\$|valor|custo/i);
    await clicar($("[data-produto]"));
    expect(($("[data-qtd-material]") as HTMLInputElement).value).toBe("1");
    await clicar($('button[aria-label="Mais 1"]'));
    await clicar($('button[aria-label="Mais 1"]'));
    await clicar($('button[aria-label="Menos 1"]'));
    expect(($("[data-qtd-material]") as HTMLInputElement).value).toBe("2");
    expect(($("[data-equipamento-material]") as HTMLSelectElement).value).toBe("eqA");
    await clicar($("[data-salvar-material]"));
    const [op] = await naFila("material");
    expect(op).toMatchObject({ atividadeId: "aA", dados: { produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 2, equipamentoId: "eqA", clientId: expect.any(String) } });
    await esperarAte(() => !!secaoEquip()!.querySelector("[data-material]"), "linha na tela");
    expect(texto(secaoEquip()!.querySelector("[data-material]"))).toContain("Capacitor 35 µF");
    expect(texto(secaoEquip()!.querySelector("[data-material]"))).toContain("2 un");
    expect(secaoEquip()!.querySelector("[data-material]")!.hasAttribute("data-pendente")).toBe(true);
    expect(ditos).toContain("Material lançado.");
  });
  it("quantidade inválida: não lança (aviso visível); decimal com vírgula vale", async () => {
    await abrirEquipamento();
    await clicar(secaoEquip()!.querySelector("[data-novo-material]"));
    await digitar($("[data-busca-material]"), "cabo");
    await clicar($("[data-produto]"));
    await digitar($("[data-qtd-material]"), "0");
    expect(($("[data-salvar-material]") as HTMLButtonElement).disabled).toBe(true);
    expect($("[data-qtd-invalida]")).toBeTruthy();
    await digitar($("[data-qtd-material]"), "abc");
    expect(($("[data-salvar-material]") as HTMLButtonElement).disabled).toBe(true);
    await digitar($("[data-qtd-material]"), "3,5");
    expect(($("[data-salvar-material]") as HTMLButtonElement).disabled).toBe(false);
    await clicar($("[data-salvar-material]"));
    expect((await gravadas("material"))[0].dados).toMatchObject({ produtoId: "pCabo", quantidade: 3.5, unidade: "m" });
  });
  it("fora do catálogo: descreve, unidade livre, sem produto", async () => {
    await abrirEquipamento();
    await clicar(secaoEquip()!.querySelector("[data-novo-material]"));
    await digitar($("[data-busca-material]"), "fita aluminizada");
    await clicar($("[data-material-avulso]"));
    expect(($("[data-descricao-material]") as HTMLInputElement).value).toBe("fita aluminizada");
    await clicar($("[data-salvar-material]"));
    expect((await gravadas("material"))[0].dados).toMatchObject({ produtoId: null, descricao: "fita aluminizada", unidade: "un", quantidade: 1 });
  });
  it("a linha DELE: toca, corrige a quantidade (mesma linha) ou remove", async () => {
    materiaisServidor.aA = [{ id: "m1", clientId: "c1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 1, equipamentoId: "eqA", meu: true, criadoPor: "João" }];
    await abrirEquipamento();
    await clicar(secaoEquip()!.querySelector('[data-material="c1"]'));
    expect(texto($("[data-material-escolhido]"))).toContain("Capacitor 35 µF");
    await digitar($("[data-qtd-material]"), "4");
    await clicar($("[data-salvar-material]"));
    expect((await gravadas("material"))[0].dados).toEqual({ clientId: "c1", quantidade: 4, equipamentoId: "eqA" });
    await esperarAte(() => texto(secaoEquip()!.querySelector('[data-material="c1"]')).includes("4 un"), "corrigido na tela");
    await clicar(secaoEquip()!.querySelector('[data-material="c1"]'));
    await clicar($("[data-remover-material]"));
    expect((await gravadas("materialRemover"))[0].dados).toEqual({ id: "m1" });
    await esperarAte(() => !secaoEquip()!.querySelector('[data-material="c1"]'), "removido da tela");
  });
  it("a linha de OUTRA pessoa: só leitura, com o nome de quem lançou", async () => {
    materiaisServidor.aA = [{ id: "m2", clientId: "c2", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 1, equipamentoId: "eqA", meu: false, criadoPor: "Maria" }];
    await abrirEquipamento();
    const l = secaoEquip()!.querySelector('[data-material="c2"]') as HTMLButtonElement;
    expect(l.disabled).toBe(true);
    expect(texto(l)).toContain("Maria");
  });
  it("atividade concluída: lista para leitura, sem adicionar, corrigir ou remover", async () => {
    status.aA = "CONCLUIDA";
    materiaisServidor.aA = [{ id: "m1", clientId: "c1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 1, equipamentoId: "eqA", meu: true, criadoPor: "João" }];
    await abrirEquipamento();
    expect(secaoEquip()!.querySelector("[data-novo-material]")).toBeNull();
    expect((secaoEquip()!.querySelector('[data-material="c1"]') as HTMLButtonElement).disabled).toBe(true);
  });
  it("na OS, a lista mostra de qual equipamento é cada material", async () => {
    materiaisServidor.aA = [{ id: "m1", clientId: "c1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 1, equipamentoId: "eqA", meu: true, criadoPor: "João" }];
    await abrirEquipamento();
    const { irPara } = await import("@/components/tecnico/contexto");
    await act(async () => { irPara({ ver: "os", a: "aA" }); });
    await esperarAte(() => !!$('[data-materiais="atividade"] [data-material="c1"]'), "lista da OS");
    expect(texto($('[data-materiais="atividade"] [data-material="c1"]'))).toContain("Split Sala 1");
  });
});

/* ═════════════════════ escritório: OS › Materiais usados em campo ═════════════════════ */
describe("escritório: Materiais usados em campo (OS)", () => {
  const LINHAS = [
    { id: "l1", atividadeId: "aA", atividade: "Preventiva", equipamento: "Split Sala 1", produtoId: "pCap", descricao: "Capacitor 35 µF", unidade: "un", quantidade: 2, veiculo: "ABC1D23 · Fiorino", daSeparacao: false,
      criadoPor: "João", criadoEm: "2026-11-12T13:00:00.000Z", corrigidoPor: null, corrigidoEm: null, removidoPor: null, removidoEm: null },
    { id: "l2", atividadeId: "aA", atividade: "Preventiva", equipamento: null, produtoId: "pGas", descricao: "Gás R-410A", unidade: "kg", quantidade: 1.5, veiculo: null, daSeparacao: true,
      criadoPor: "João", criadoEm: "2026-11-12T13:10:00.000Z", corrigidoPor: "Ana", corrigidoEm: "2026-11-12T16:00:00.000Z", removidoPor: "Ana", removidoEm: "2026-11-12T16:05:00.000Z" },
  ];
  let pedidos: { url: string; metodo: string; corpo: any }[] = [];
  async function montar(podeCorrigir = true) {
    pedidos = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      pedidos.push({ url: u, metodo: init?.method ?? "GET", corpo: init?.body ? JSON.parse(String(init.body)) : null });
      if (!init?.method) return json({ linhas: LINHAS });
      return json(init.method === "PATCH" ? { avisos: [] } : { removido: true });
    }));
    const { MateriaisCampo } = await import("@/components/os/materiais-campo");
    const { Avisos } = await import("@/components/ui/avisos");
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement("div", null, createElement(Avisos), createElement(MateriaisCampo, { osId: "osA", podeCorrigir }))); });
    await esperarAte(() => !!$("[data-materiais-campo]"), "card");
  }
  it("lista com quem lançou, veículo, separação e o registro de correção/estorno (estornado riscado, sem ações)", async () => {
    await montar();
    const l1 = $('[data-linha-campo="l1"]')!;
    expect(texto(l1)).toContain("Capacitor 35 µF");
    expect(texto(l1)).toContain("2 un");
    expect(texto(l1)).toContain("Veículo ABC1D23 · Fiorino");
    expect(texto(l1)).toContain("Lançado por João em 12/11/2026 10:00");
    expect(l1.querySelector("[data-corrigir-campo]")).toBeTruthy();
    const l2 = $('[data-linha-campo="l2"]')!;
    expect(l2.hasAttribute("data-estornado")).toBe(true);
    expect(texto(l2)).toContain("da separação da OS");
    expect(texto(l2)).toContain("corrigido por Ana em 12/11/2026 13:00");
    expect(texto(l2)).toContain("estornado por Ana em 12/11/2026 13:05");
    expect(l2.querySelector("[data-corrigir-campo], [data-estornar-campo]")).toBeNull();
    expect(texto($("[data-materiais-campo]"))).not.toMatch(/R\$|custo/i);
  });
  it("corrigir: PATCH com a quantidade (vírgula vale); estornar: confirma e DELETE", async () => {
    await montar();
    await clicar($('[data-linha-campo="l1"] [data-corrigir-campo]'));
    await digitar($('[data-modal-corrigir-campo] input') as HTMLInputElement, "1,5");
    await clicar($("[data-salvar-correcao]"));
    await esperarAte(() => pedidos.some((p) => p.metodo === "PATCH"), "PATCH");
    expect(pedidos.find((p) => p.metodo === "PATCH")).toEqual({ url: "/api/ordens/osA/materiais-campo/l1", metodo: "PATCH", corpo: { quantidade: 1.5 } });
    await clicar($('[data-linha-campo="l1"] [data-estornar-campo]'));
    await esperarAte(() => pedidos.some((p) => p.metodo === "DELETE"), "DELETE");
    expect(pedidos.find((p) => p.metodo === "DELETE")!.url).toBe("/api/ordens/osA/materiais-campo/l1");
  });
  it("sem OS › Editar: só leitura", async () => {
    await montar(false);
    expect($("[data-corrigir-campo]")).toBeNull();
    expect($("[data-estornar-campo]")).toBeNull();
  });
});
