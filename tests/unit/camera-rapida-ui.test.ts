// @vitest-environment happy-dom
/**
 * CÂMERA RÁPIDA — a tela do app do técnico num DOM de verdade, com o banco do aparelho de verdade
 * (IndexedDB via fake-indexeddb), o motor de sincronização real e QR codes de verdade nas "fotos"
 * (o jsQR decodifica os pixels). Só a câmera, o canvas e o servidor são simulados — e o servidor
 * valida cada gravação com o MESMO esquema da fila de produção.
 *  - atalho grande na OS (e no Meu dia) que abre direto na câmera; rajada sem diálogo, legenda ou seleção;
 *  - grupos por janela de tempo e por "Próximo equipamento";
 *  - etiqueta QR fotografada → o grupo grava sozinho no equipamento; sem etiqueta → "a identificar"
 *    (nunca chute): escolher, etiquetar novo (cadastro em campo), geral da OS ou descartar;
 *  - antes/depois num toque; "TUDO OK" por equipamento na conferência;
 *  - OFFLINE: tudo no aparelho; fechar e reabrir não perde nada; sobe quando o sinal volta;
 *  - permissões do app: marca d'água, foto só câmera, dados do cliente escondidos.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import { guardaDo } from "@/lib/tecnico/offline/rapida";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { operacaoSchema } from "@/lib/tecnico/sync";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";
import { imagemLisa, imagemQr, type ImagemQr } from "./qr-exemplo";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
// O caminho de toda foto do app: aqui só se registra por onde ela passou (redução e marca d'água)
const imagem = vi.hoisted(() => ({ n: 0, reduzidas: [] as unknown[], marca: null as unknown as ReturnType<typeof import("vitest")["vi"]["fn"]> }));
vi.mock("@/lib/imagem-cliente", async () => {
  const { vi: v } = await import("vitest");
  imagem.marca = v.fn(async (dataUrl: string, _linhas: string[]) => `${dataUrl}+marca`);
  return {
    FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
    reduzirImagem: v.fn(async (f: Blob, lado: number, q: number) => { imagem.reduzidas.push([lado, q]); return { imagem: { dataUrl: `data:image/jpeg;base64,/9j/FOTO-DA-CAMERA-RAPIDA-${String(++imagem.n).padStart(3, "0")}`, largura: 10, altura: 10, bytes: f.size }, qualidade: {} }; }),
    aplicarMarcaDagua: (dataUrl: string, linhas: string[]) => imagem.marca(dataUrl, linhas),
    dataUrlParaArquivo: (_d: string, nome: string) => new File([new Uint8Array([1, 2, 3])], nome, { type: "image/jpeg" }),
  };
});
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));

/* ───────── relógio (para as janelas de tempo) ───────── */
const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const passar = (ms: number) => vi.setSystemTime(Date.now() + ms);

/* ───────── dados ───────── */
const QR_A = "https://app.frivo.com.br/qr/tok-eqA"; // etiqueta do Split Sala 1 (já na OS)
const QR_N = "https://app.frivo.com.br/qr/tok-eqN"; // etiqueta do Split do auditório (da unidade, fora da OS)
const AVULSA = "https://app.frivo.com.br/qr/tok-avulsa-77"; // etiqueta impressa, ainda sem equipamento
const item = (id: string, texto: string) => ({ id, texto, pedirFoto: false, pedirObservacao: false, ativo: true, ordem: 1, tipoResposta: "OK_ATENCAO_NA" as const, unidade: null });
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = (id: string, titulo: string, local: string) => ({ id, titulo, descricao: titulo, fabricante: "Daikin", tag: null, numeroSerie: null, local, unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } });
let ajustar: (r: any) => any = (r) => r;
function base(): RetratoAtividade {
  return ajustar({
    cartao: {
      atividadeId: "aA", osId: "os1", osNumero: "OS-0042", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: null, hora: "13:00", duracaoMin: 60,
      cliente: "Hospital Santa Luzia", telefone: null, unidade: "Matriz", endereco: "Av. Paulista, 1000 — São Paulo/SP", rota: null, descricao: "Preventiva mensal", equipamentos: 1, atendidos: 0, adicionais: 0,
    },
    execucao: {
      atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-0042", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
      bloqueada: false, adicionais: [], fotosServico: [],
      equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info("eqA", "Split Sala 1", "Sala 1"), itens: [item("i1", "Limpeza dos filtros"), item("i2", "Dreno")], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
      conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
    },
    equipamentosUnidade: [
      { ...info("eqA", "Split Sala 1", "Sala 1"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-eqA", codigo: "QR-0001" } },
      { ...info("eqN", "Split do auditório", "Auditório"), tipoEquipamentoId: "te1", qr: { tokenPublico: "tok-eqN", codigo: "QR-0002" } },
      { ...info("eqS", "Câmara fria", "Cozinha"), tipoEquipamentoId: null, qr: null },
    ],
    checklistsPorTipo: { te1: [item("i1", "Limpeza dos filtros"), item("i2", "Dreno")] },
    cadastro: { unidadeId: "un1", tipos: [{ valor: "AR_CONDICIONADO_SPLIT", nome: "Split Hi-Wall", tipoEquipamentoId: "te1" }], setores: [], ambientes: [] },
    avisoCliente: null,
    geradoEm: new Date().toISOString(),
  }) as RetratoAtividade;
}

/* ───────── servidor simulado: aplica o que recebeu com as regras do próprio app ───────── */
let online = true;
let enviadas: any[] = [];
let invalidas: unknown[] = [];
const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url.includes("/api/tecnico/meu-dia")) return json({ tecnico: { id: "t1", nome: "João" }, dia: "2026-11-12", atividades: [base().cartao], anteriores: [] });
  if (url.startsWith("/api/tecnico/atividades/")) {
    const r = base();
    return json({ ...r, execucao: estadoDaAtividade(r, enviadas.map((o, i) => ({ ...o, seq: i + 1, criadoEm: o.em, estado: "enviada", tentativas: 0 }))) });
  }
  if (url === "/api/tecnico/sync") {
    const { operacoes } = JSON.parse(String(init!.body));
    return json({ resultados: operacoes.map((o: any) => {
      const ok = operacaoSchema.safeParse(o).success; // o esquema da fila de produção
      if (!ok) { invalidas.push(o); return { id: o.id, ok: false, status: 400, erro: "inválida" }; }
      if (!enviadas.some((e) => e.id === o.id)) enviadas.push(o);
      return { id: o.id, ok: true, status: 200, dados: {} };
    }) });
  }
  return json({}, 404);
});

/* ───────── o "aparelho": câmera e canvas ───────── */
let cena: (largura: number, altura: number) => ImagemQr;
let getUserMedia: ReturnType<typeof vi.fn>;
let faixas: { stop: ReturnType<typeof vi.fn> }[] = [];
const erro = (name: string) => Object.assign(new Error(name), { name });
function ligarAparelho() {
  Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: (...a: unknown[]) => getUserMedia(...a) } });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { configurable: true, writable: true, value: null });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 1080 });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ drawImage: () => undefined, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: cena(w, h).dados, width: w, height: h }) }) });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", { configurable: true, value(cb: (b: Blob) => void) { cb(new Blob([new Uint8Array([9, 9, 9])], { type: "image/jpeg" })); } });
  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", { configurable: true, value: () => "data:image/jpeg;base64,MINI" });
  (globalThis as any).createImageBitmap = async () => ({ width: 1280, height: 960, close: () => undefined });
}

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync; let aparelho: IDBFactory;

async function ligarMotor() {
  banco = await BancoTecnico.abrir("uT", aparelho);
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
}
beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/app-tecnico"), import("@/components/tecnico/execucao"), import("@/components/tecnico/camera-rapida"), import("@/components/tecnico/conferencia-rapida"), import("@/components/tecnico/cadastro-equipamento")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(MEIO_DIA);
  aparelho = new IDBFactory(); (globalThis as any).indexedDB = aparelho;
  online = true; enviadas = []; invalidas = []; faixas = []; ajustar = (r) => r; imagem.n = 0; imagem.reduzidas = []; imagem.marca?.mockClear(); fetchFalso.mockClear();
  cena = (w, h) => imagemLisa(w, h);
  getUserMedia = vi.fn(async () => { const f = [{ stop: vi.fn() }]; faixas.push(...f); return { getTracks: () => f }; });
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  ligarAparelho();
  await ligarMotor();
  window.history.replaceState(null, "", "/tecnico?ver=os&a=aA");
});
afterEach(() => {
  if (root) act(() => root.unmount());
  caixa?.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root;
  banco.fechar(); delete (globalThis as any).createImageBitmap;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

const USUARIO = { id: "uT", nome: "João Silva", email: "joao@clima.com", empresaNome: "Clima Total", podeGravar: true };
const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean | Promise<boolean>, msg: string) {
  for (let i = 0; i < 200; i++) { if (await cond()) return; await esperar(1); }
  throw new Error(`não aconteceu: ${msg}`);
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const $$ = (sel: string) => [...document.body.querySelectorAll(sel)] as HTMLElement[];
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string) => [...document.body.querySelectorAll("button")].find((b) => texto(b) === rotulo) ?? null;

const guarda = () => guardaDo(banco);
const guardadas = async () => (await guarda().sessao("aA")).fotos;
const fila = async () => (await banco.fila()).filter((o) => o.estado !== "enviada");
/** O que o técnico gravou: na fila do aparelho ou já no servidor */
async function gravadas(tipo?: string): Promise<any[]> {
  const vistas = new Set<string>();
  return [...(await banco.fila()), ...enviadas].filter((o: any) => (!tipo || o.tipo === tipo) && !vistas.has(o.id) && vistas.add(o.id));
}

async function abrirOs(config?: any) {
  const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { Avisos } = await import("@/components/ui/avisos"); // avisos e confirmações, como no app
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, children: [createElement(Avisos, { key: "avisos" }), createElement(VistaOs, { key: "os", atividadeId: "aA" })] })); });
  await esperarAte(() => !!$("[data-vista]"), "OS carregada");
  await esperar();
}
async function abrirCamera(config?: any) {
  if (!root) await abrirOs(config);
  await clicar($("[data-abrir-camera-rapida]"));
  await esperarAte(() => $("[data-camera-rapida]")?.getAttribute("data-fase") !== "abrindo", "câmera aberta");
}
/** Tira `n` fotos e espera todas ficarem guardadas no aparelho */
async function disparar(n = 1) {
  const antes = (await guardadas()).length;
  for (let i = 0; i < n; i++) { await act(async () => { $("[data-rapida-disparo]")!.click(); }); passar(2000); }
  await esperarAte(async () => (await guardadas()).length === antes + n, `${n} foto(s) guardada(s)`);
  await esperar(2);
}
async function pronto() {
  await clicar($("[data-rapida-pronto]"));
  await esperarAte(() => !$("[data-camera-rapida]"), "câmera fechada");
  await esperar();
}
const conferencia = () => $("[data-conferencia-rapida]");
const pendentes = () => $$("[data-grupo-estado='a-identificar']");
const organizadas = () => $$("[data-grupo-estado='salvo']");

/* ═════════════════════════ 1. o atalho e a rajada ═════════════════════════ */
describe("atalho grande e câmera em rajada", () => {
  it("na OS: 'Câmera rápida' em destaque, acima dos equipamentos, com alvo de 44 px", async () => {
    await abrirOs();
    const b = $("[data-abrir-camera-rapida]")!;
    expect(texto(b)).toBe("Câmera rápida");
    expect(b.className).toContain("touch-target");
    expect(b.className).toContain("w-full");
    const equipamentos = [...document.querySelectorAll("h2")].find((h) => texto(h) === "Equipamentos")!;
    expect(b.compareDocumentPosition(equipamentos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("atividade concluída (só leitura): sem o atalho", async () => {
    ajustar = (r) => ({ ...r, execucao: { ...r.execucao, bloqueada: true, atividade: { ...r.execucao.atividade, status: "CONCLUIDA" } } });
    await abrirOs();
    expect($("[data-abrir-camera-rapida]")).toBeNull();
  });

  it("abre DIRETO na câmera (traseira, resolução de foto, sem áudio) — sem pergunta, legenda ou seleção antes", async () => {
    await abrirCamera();
    const cam = $("[data-camera-rapida]")!;
    expect(cam.getAttribute("data-fase")).toBe("pronta");
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    expect($("[data-camera-rapida] video")!.hasAttribute("playsinline")).toBe(true);
    // Nada para escrever ou escolher dentro da câmera
    expect(cam.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(cam.getAttribute("role")).toBe("dialog");
  });

  it("clica, clica, clica: as miniaturas empilham e cada foto já fica guardada no aparelho — nada vai para o servidor ainda", async () => {
    await abrirCamera();
    await disparar(3);
    expect($$("[data-rapida-miniatura]")).toHaveLength(3);
    expect($$("[data-rapida-miniatura='pronta']")).toHaveLength(3);
    expect(texto($("[data-rapida-total]"))).toBe("3");
    const fotos = await guardadas();
    expect(fotos.map((f) => f.momento)).toEqual(["ANTES", "ANTES", "ANTES"]);
    expect(new Set(fotos.map((f) => f.id)).size).toBe(3);
    for (const f of fotos) expect(await guarda().imagem(f.id)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await gravadas()).toEqual([]); // sem equipamento, a foto espera no aparelho
    expect($("[data-camera-rapida]")!.querySelectorAll("input, textarea, select")).toHaveLength(0); // continua sem diálogo
  });

  it("alvos de toque: disparo grande, antes/depois, próximo, pronto e fechar com 44 px ou mais", async () => {
    await abrirCamera();
    expect($("[data-rapida-disparo]")!.className).toContain("w-[76px]");
    for (const el of [$("[data-rapida-pronto]")!, $("[data-rapida-proximo]")!, $("[aria-label='Fechar a câmera']")!, ...$$("[data-rapida-momento] button")]) expect(el.className).toContain("touch-target");
  });

  it("fechar a câmera desliga a câmera do aparelho", async () => {
    await abrirCamera();
    await pronto();
    expect(faixas[0].stop).toHaveBeenCalledTimes(1);
  });
});

/* ═════════════════════════ 5. antes / depois ═════════════════════════ */
describe("antes / depois num toque", () => {
  it("o padrão é ANTES; um toque em 'Depois' vale para as próximas fotos; dá para voltar", async () => {
    await abrirCamera();
    expect($("[data-rapida-momento]")!.getAttribute("data-rapida-momento")).toBe("ANTES");
    expect(botao("Antes")!.getAttribute("aria-pressed")).toBe("true");
    await disparar(2);
    await clicar(botao("Depois"));
    expect(botao("Depois")!.getAttribute("aria-pressed")).toBe("true");
    await disparar(2);
    await clicar(botao("Antes"));
    await disparar(1);
    expect((await guardadas()).map((f) => f.momento)).toEqual(["ANTES", "ANTES", "DEPOIS", "DEPOIS", "ANTES"]);
  });
});

/* ═════════════════════════ 3. identidade pelo QR da foto ═════════════════════════ */
describe("etiqueta QR fotografada: o grupo vai sozinho para o equipamento", () => {
  it("o QR é lido da FOTO, no aparelho: a miniatura ganha o selo e a câmera mostra de quem é o grupo", async () => {
    await abrirCamera();
    await disparar(1); // o equipamento
    expect($("[data-rapida-identificado]")).toBeNull();
    expect(texto($("[data-rapida-dica]"))).toBe("Fotografe a etiqueta QR junto: o app identifica");
    cena = (w, h) => imagemQr(QR_A, w, h, { ocupacao: 0.5 });
    await disparar(1); // a etiqueta
    expect((await guardadas()).map((f) => f.qr)).toEqual([null, QR_A]);
    expect($$("[data-rapida-qr]")).toHaveLength(1);
    expect(texto($("[data-rapida-identificado]"))).toBe("Split Sala 1");
  });

  it("'Pronto': a conferência abre, o grupo é gravado SEM toque nenhum — fotos antes/depois no equipamento da etiqueta", async () => {
    await abrirCamera();
    await disparar(2);
    cena = (w, h) => imagemQr(QR_A, w, h);
    await disparar(1);
    cena = (w, h) => imagemLisa(w, h);
    await clicar(botao("Depois"));
    await disparar(1);
    await pronto();
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    const fotos = await gravadas("foto");
    expect(fotos.map((o) => [o.equipamentoId, o.dados.momento])).toEqual([["eqA", "ANTES"], ["eqA", "ANTES"], ["eqA", "ANTES"], ["eqA", "DEPOIS"]]);
    expect(new Set(fotos.map((o) => o.dados.clientId)).size).toBe(4);
    expect(await gravadas("vincular")).toEqual([]); // o equipamento já estava na OS
    expect(await guardadas()).toEqual([]); // saíram da guarda: agora são gravações da fila
    expect(invalidas).toEqual([]);
    const card = organizadas()[0];
    expect(texto(card.querySelector("[data-grupo-nome]"))).toBe("Split Sala 1");
    expect(texto(card)).toContain("4 fotos · 3 antes · 1 depois · pela etiqueta QR");
    expect(pendentes()).toEqual([]);
    expect(texto($("[data-fechar-conferencia]"))).toBe("Concluído");
  });

  it("etiqueta de equipamento da unidade que ainda NÃO está na OS: vincula e põe as fotos, nessa ordem", async () => {
    cena = (w, h) => imagemQr(QR_N, w, h);
    await abrirCamera();
    await disparar(2);
    await pronto();
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    const ops = (await gravadas()).filter((o) => o.tipo !== "iniciar");
    expect(ops.map((o) => o.tipo)).toEqual(["vincular", "foto", "foto"]);
    expect(ops[0].equipamentoIds).toEqual(["eqN"]);
    expect(ops.slice(1).every((o) => o.equipamentoId === "eqN")).toBe(true);
    expect(texto(organizadas()[0].querySelector("[data-grupo-nome]"))).toBe("Split do auditório");
  });

  it("um grupo com etiqueta e outro sem: só o da etiqueta grava; o outro NÃO herda o equipamento", async () => {
    cena = (w, h) => imagemQr(QR_A, w, h);
    await abrirCamera();
    await disparar(2);
    passar(60_000); // andou para outra máquina
    cena = (w, h) => imagemLisa(w, h);
    await disparar(2);
    await pronto();
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    expect((await gravadas("foto")).map((o) => o.equipamentoId)).toEqual(["eqA", "eqA"]);
    expect(pendentes()).toHaveLength(1);
    expect((await guardadas()).length).toBe(2);
  });
});

/* ═════════════════════════ 2. grupos por tempo ═════════════════════════ */
describe("grupos por janela de tempo", () => {
  it("rajada = um grupo; mais de 30 s sem foto = outro grupo; 'Próximo equipamento' corta na hora", async () => {
    await abrirCamera();
    await disparar(3);      // máquina 1 (2 s entre as fotos)
    passar(45_000);
    await disparar(2);      // máquina 2
    expect($("[data-rapida-proximo]")!.hasAttribute("disabled")).toBe(false);
    await clicar($("[data-rapida-proximo]"));
    expect(texto($("[data-rapida-dica]"))).toBe("Próxima foto começa outro equipamento");
    expect($<HTMLButtonElement>("[data-rapida-proximo]")!.disabled).toBe(true); // um toque basta
    await disparar(1);      // máquina 3, logo ao lado
    await pronto();
    await esperarAte(() => pendentes().length === 3, "três grupos");
    expect(pendentes().map((g) => g.querySelectorAll("[data-foto-grupo]").length)).toEqual([3, 2, 1]);
    expect(texto($("[data-conferencia-pendentes] h3"))).toBe("A identificar (3)");
  });
});

/* ═════════════════════════ 4. a identificar: nunca chute ═════════════════════════ */
describe("sem etiqueta legível: a identificar — o técnico resolve, o app não escolhe", () => {
  async function fotografarSemQr(n = 2) { await abrirCamera(); await disparar(n); await pronto(); await esperarAte(() => pendentes().length === 1, "grupo a identificar"); }

  it("nada é gravado nem vinculado sozinho; a conferência diz o motivo e oferece as saídas, com 44 px", async () => {
    await fotografarSemQr(3);
    expect(await gravadas()).toEqual([]);
    const g = pendentes()[0];
    expect(g.getAttribute("data-motivo")).toBe("sem-qr");
    expect(texto(g.querySelector("[data-grupo-motivo]"))).toBe("Sem QR legível nas fotos.");
    expect(texto(g)).toContain("3 fotos · 3 antes");
    for (const sel of ["[data-escolher-equipamento]", "[data-etiquetar]", "[data-grupo-geral]", "[data-descartar-grupo]"]) expect(g.querySelector(sel)!.className, sel).toContain("touch-target");
    expect(texto($("[data-fechar-conferencia]"))).toBe("Resolver depois");
    expect(organizadas()).toEqual([]);
  });

  it("'Escolher o equipamento': lista os da OS e os outros da unidade; um toque grava as fotos nele", async () => {
    await fotografarSemQr(2);
    await clicar(pendentes()[0].querySelector("[data-escolher-equipamento]"));
    expect($$("[data-opcao-equipamento]").map((o) => o.getAttribute("data-opcao-equipamento"))).toEqual(["eqA", "eqN", "eqS"]);
    expect(texto($("[data-escolha-equipamento]"))).toMatch(/Nesta OS.*Split Sala 1.*Outros da unidade.*Split do auditório.*Câmara fria/);
    for (const o of $$("[data-opcao-equipamento]")) expect(o.className).toContain("touch-target");
    await clicar($("[data-opcao-equipamento='eqS']"));
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    const ops = (await gravadas()).filter((o) => o.tipo !== "iniciar");
    expect(ops.map((o) => o.tipo)).toEqual(["vincular", "foto", "foto"]);
    expect(ops[0].equipamentoIds).toEqual(["eqS"]);
    expect(texto(organizadas()[0])).toContain("Câmara fria");
    expect(texto(organizadas()[0])).not.toContain("pela etiqueta QR"); // foi o técnico quem disse
    expect(pendentes()).toEqual([]);
    expect(invalidas).toEqual([]);
  });

  it("'Geral da OS': vai para Fotos do serviço, sem equipamento, com a legenda automática", async () => {
    await fotografarSemQr(2);
    await clicar(pendentes()[0].querySelector("[data-grupo-geral]"));
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    const fotos = await gravadas("fotoOs");
    expect(fotos.map((o) => [o.dados.equipamentoId, o.dados.legenda])).toEqual([[null, "Câmera rápida — antes"], [null, "Câmera rápida — antes"]]);
    expect(await gravadas("foto")).toEqual([]);
    expect(texto(organizadas()[0].querySelector("[data-grupo-nome]"))).toBe("Geral da OS");
    expect(invalidas).toEqual([]);
  });

  it("'Descartar': pede confirmação; confirmado, as fotos saem do aparelho e nada vai para a OS", async () => {
    await fotografarSemQr(2);
    await clicar(pendentes()[0].querySelector("[data-descartar-grupo]"));
    expect(texto()).toContain("Descartar estas fotos?");
    expect((await guardadas()).length).toBe(2); // só pedir não apaga
    await clicar($("[data-confirmar-sim]"));
    await esperarAte(async () => (await guardadas()).length === 0, "fotos descartadas");
    expect(await gravadas()).toEqual([]);
    expect(pendentes()).toEqual([]);
  });

  it("DUAS etiquetas no mesmo grupo: a identificar; 'Separar' na foto certa resolve os dois sozinhos", async () => {
    cena = (w, h) => imagemQr(QR_A, w, h);
    await abrirCamera();
    await disparar(2);
    cena = (w, h) => imagemQr(QR_N, w, h); // emendou na máquina ao lado, sem pausa
    await disparar(2);
    await pronto();
    await esperarAte(() => pendentes().length === 1, "grupo em conflito");
    const g = pendentes()[0];
    expect(g.getAttribute("data-motivo")).toBe("dois-equipamentos");
    expect(texto(g.querySelector("[data-grupo-motivo]"))).toBe("Duas etiquetas no mesmo grupo: separe na primeira foto do outro equipamento.");
    expect(await gravadas()).toEqual([]); // não escolheu nenhuma das duas
    const fotos = [...g.querySelectorAll<HTMLButtonElement>("[data-foto-grupo]")];
    expect(fotos[0].disabled).toBe(true); // a primeira já começa o grupo
    await clicar(fotos[2]);
    await clicar($("[data-separar-aqui]"));
    await esperarAte(() => organizadas().length === 2, "os dois grupos organizados");
    expect((await gravadas("foto")).map((o) => o.equipamentoId).sort()).toEqual(["eqA", "eqA", "eqN", "eqN"]);
    expect(pendentes()).toEqual([]);
  });

  it("etiqueta AVULSA fotografada: 'Etiquetar novo' abre o cadastro em campo já com ela; salvando, as fotos vão para o equipamento novo", async () => {
    cena = (w, h) => imagemQr(AVULSA, w, h);
    await abrirCamera();
    await disparar(2);
    await pronto();
    await esperarAte(() => pendentes().length === 1, "grupo a identificar");
    expect(pendentes()[0].getAttribute("data-motivo")).toBe("etiqueta-desconhecida");
    expect(texto(pendentes()[0].querySelector("[data-grupo-motivo]"))).toBe("A etiqueta fotografada ainda não é de um equipamento daqui.");
    await clicar(pendentes()[0].querySelector("[data-etiquetar]"));
    const modal = $("[data-modal-cadastro-equipamento]")!;
    expect(texto(modal)).toContain("Etiqueta QR lida.");
    const tipo = modal.querySelector<HTMLSelectElement>("select")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(tipo, "AR_CONDICIONADO_SPLIT"); tipo.dispatchEvent(new Event("change", { bubbles: true })); });
    await clicar($("[data-salvar-equipamento]"));
    await esperarAte(async () => (await gravadas("foto")).length === 2, "fotos no equipamento novo");
    const [cadastro] = await gravadas("cadastrarEquipamento");
    expect(cadastro.dados.qrLido).toBe(AVULSA);
    const fotos = await gravadas("foto");
    expect(fotos.every((o) => o.equipamentoId === cadastro.dados.id)).toBe(true);
    expect(await gravadas("vincular")).toEqual([]); // o cadastro em campo já vincula
    const ordem = (await gravadas()).map((o) => o.tipo).filter((t) => t !== "iniciar");
    expect(ordem.indexOf("cadastrarEquipamento")).toBeLessThan(ordem.indexOf("foto"));
    expect(await guardadas()).toEqual([]);
    expect(invalidas).toEqual([]);
  });

  it("'Permitir cadastrar equipamento em campo' DESLIGADO: sem 'Etiquetar novo' (as outras saídas continuam)", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, cadastrarEquipamento: false });
    await abrirCamera(); await disparar(1); await pronto();
    await esperarAte(() => pendentes().length === 1, "grupo a identificar");
    expect(pendentes()[0].querySelector("[data-etiquetar]")).toBeNull();
    expect(pendentes()[0].querySelector("[data-escolher-equipamento]")).toBeTruthy();
    expect(pendentes()[0].querySelector("[data-grupo-geral]")).toBeTruthy();
  });

  it("fotos a identificar não ficam para trás: a OS mostra o aviso e 'Concluir atividade' leva à conferência", async () => {
    await fotografarSemQr(2);
    await clicar($("[data-fechar-conferencia]"));
    expect(conferencia()).toBeNull();
    expect(texto($("[data-conferir-fotos]"))).toBe("2 fotos a identificar — toque para conferir");
    expect($("[data-conferir-fotos]")!.className).toContain("touch-target");
    await clicar($("[data-concluir-atividade]"));
    expect(conferencia()).toBeTruthy();
    expect($("[data-confirmar-conclusao]")).toBeNull(); // o concluir não abriu
    expect(await gravadas("concluir")).toEqual([]);
  });
});

/* ═════════════════════════ 6. tudo OK num toque ═════════════════════════ */
describe("'TUDO OK' por equipamento, junto das fotos", () => {
  it("na conferência, o equipamento organizado tem 'TUDO OK' (o mesmo do checklist) e 'Abrir' para a exceção", async () => {
    cena = (w, h) => imagemQr(QR_A, w, h);
    await abrirCamera(); await disparar(2); await pronto();
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    const ok = organizadas()[0].querySelector<HTMLButtonElement>("[data-tudo-ok-rapido]")!;
    expect(texto(ok)).toBe("TUDO OK");
    expect(ok.className).toContain("touch-target");
    await clicar(ok);
    await esperarAte(async () => (await gravadas("tudoOk")).length === 1, "tudo OK gravado");
    expect((await gravadas("tudoOk"))[0]).toMatchObject({ atividadeId: "aA", equipamentoId: "eqA" });
    await esperarAte(() => texto(organizadas()[0]?.querySelector("[data-tudo-ok-rapido]") ?? null) === "Checklist OK", "checklist fechado");
    expect(organizadas()[0].querySelector<HTMLButtonElement>("[data-tudo-ok-rapido]")!.disabled).toBe(true);
    // A exceção (Atenção, com foto e observação) é escrita na tela do equipamento, que já existe
    await clicar(organizadas()[0].querySelector("[data-abrir-equipamento]"));
    expect(window.location.search).toBe("?ver=os&a=aA&e=eqA");
  });
});

/* ═════════════════════════ offline ═════════════════════════ */
describe("OFFLINE total", () => {
  it("sem sinal: fotografa, lê o QR, agrupa e põe na fila — nenhuma chamada de rede; o sinal volta e sobe sozinho", async () => {
    await motor.baixarRetrato("aA"); // a OS já estava no aparelho
    online = false; fetchFalso.mockClear();
    cena = (w, h) => imagemQr(QR_A, w, h);
    await abrirCamera(); await disparar(3); await pronto();
    await esperarAte(() => organizadas().length === 1, "grupo organizado");
    expect(enviadas).toEqual([]);
    expect((await fila()).filter((o) => o.tipo === "foto").map((o: any) => o.equipamentoId)).toEqual(["eqA", "eqA", "eqA"]);
    expect(await guardadas()).toEqual([]);
    online = true;
    await act(async () => { await motor.sincronizar(true); });
    await esperarAte(() => enviadas.filter((o) => o.tipo === "foto").length === 3, "fotos no servidor");
    expect(invalidas).toEqual([]);
  });

  it("fechar e reabrir o app SEM SINAL: as fotos a identificar continuam lá, com imagem, grupo e antes/depois", async () => {
    await motor.baixarRetrato("aA");
    online = false;
    await abrirCamera(); await disparar(2);
    await clicar(botao("Depois")); passar(50_000); await disparar(1);
    const antes = await guardadas();
    // app fechado no meio (nem tocou em "Pronto")
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root;
    banco.fechar();
    await ligarMotor(); // reabriu: outro motor, o MESMO aparelho
    await abrirOs();
    expect(texto($("[data-conferir-fotos]"))).toBe("3 fotos a identificar — toque para conferir");
    expect((await guardadas()).map((f) => [f.id, f.momento])).toEqual(antes.map((f) => [f.id, f.momento]));
    for (const f of antes) expect(await guarda().imagem(f.id)).toMatch(/^data:image\/jpeg/);
    await clicar($("[data-conferir-fotos]"));
    await esperarAte(() => pendentes().length === 2, "os dois grupos");
    expect(pendentes().map((g) => texto(g).match(/\d+ fotos? · [^S]+/)?.[0].trim())).toEqual(["2 fotos · 2 antes", "1 foto · 1 depois"]);
    // E resolve sem sinal mesmo: vai para a fila
    await clicar(pendentes()[0].querySelector("[data-escolher-equipamento]"));
    await clicar($("[data-opcao-equipamento='eqA']"));
    await esperarAte(async () => (await fila()).filter((o) => o.tipo === "foto").length === 2, "fotos na fila");
    expect(enviadas).toEqual([]);
  });
});

/* ═════════════════════════ permissões do app ═════════════════════════ */
describe("respeita as permissões do app do colaborador", () => {
  it("toda foto passa pelo caminho de sempre: reduzida a 1280 px e, com a marca d'água ligada, carimbada (data/hora + OS)", async () => {
    await abrirCamera(); await disparar(2);
    expect(imagem.reduzidas).toEqual([[1280, 0.8], [1280, 0.8]]);
    expect(imagem.marca).toHaveBeenCalledTimes(2);
    const linhas = imagem.marca.mock.calls[0][1] as string[];
    expect(linhas[0]).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    expect(linhas).toContain("OS OS-0042");
    expect(linhas.join(" ")).not.toContain("Paulista"); // endereço só se a empresa ligar
    for (const f of await guardadas()) expect(await guarda().imagem(f.id)).toMatch(/\+marca$/);
  });

  it("marca d'água DESLIGADA: nenhuma foto é carimbada; endereço LIGADO: vai na marca", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, marcaDagua: false });
    await abrirCamera(); await disparar(1);
    expect(imagem.marca).not.toHaveBeenCalled();
    act(() => root.unmount()); caixa.remove(); document.body.innerHTML = ""; root = undefined as unknown as Root;
    await abrirOs({ ...CONFIG_APP_PADRAO, marcaDaguaEndereco: true });
    await abrirCamera(); await disparar(1);
    expect((imagem.marca.mock.calls[0][1] as string[])).toContain("Av. Paulista, 1000 — São Paulo/SP");
  });

  it("'Exibir dados do cliente' DESLIGADO: nem a câmera nem a conferência mostram nome ou endereço do cliente", async () => {
    await abrirOs({ ...CONFIG_APP_PADRAO, exibirDadosCliente: false, exibirContatosCliente: false });
    await abrirCamera(); await disparar(2);
    expect(texto($("[data-camera-rapida]"))).not.toMatch(/Hospital|Paulista/);
    await pronto();
    await esperarAte(() => pendentes().length === 1, "grupo a identificar");
    expect(texto(conferencia())).not.toMatch(/Hospital|Paulista/);
  });

  it("câmera ao vivo BLOQUEADA: explica e cai no botão de foto de sempre — com 'foto só câmera' ligado, ele continua só câmera", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    await abrirOs({ ...CONFIG_APP_PADRAO, fotoSomenteCamera: true });
    await abrirCamera();
    const cam = $("[data-camera-rapida]")!;
    expect(cam.getAttribute("data-fase")).toBe("sem-camera");
    expect(texto($("[data-rapida-sem-camera]"))).toContain("Câmera bloqueada neste navegador.");
    const input = cam.querySelector<HTMLInputElement>("[data-foto-input]")!;
    expect(input.getAttribute("capture")).toBe("environment");
    expect(input.hasAttribute("data-somente-camera")).toBe(true);
    // Foto antiga (galeria) é recusada pela mesma regra do app; a tirada agora entra
    const escolher = async (quando: number) => {
      await act(async () => {
        Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1])], "f.jpg", { type: "image/jpeg", lastModified: quando })] });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await esperar();
    };
    await escolher(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(texto($("[data-erro-foto]"))).toContain("só aceita foto tirada na hora");
    expect(await guardadas()).toEqual([]);
    cena = (w, h) => imagemQr(QR_A, w, h);
    await escolher(Date.now());
    await esperarAte(async () => (await guardadas()).length === 1, "foto guardada");
    expect((await guardadas())[0]).toMatchObject({ momento: "ANTES", qr: QR_A }); // o QR da foto vale do mesmo jeito
    expect(texto($("[data-rapida-identificado]"))).toBe("Split Sala 1");
  });
});

/* ═════════════════════════ atalho no Meu dia ═════════════════════════ */
describe("atalho no Meu dia", () => {
  it("cada OS em aberto tem 'Câmera' (44 px): abre a OS já na câmera rápida e tira o atalho do endereço", async () => {
    window.history.replaceState(null, "", "/tecnico");
    const { ProvedorTecnico } = await import("@/components/tecnico/contexto");
    const { AppTecnico } = await import("@/components/tecnico/app-tecnico");
    void ProvedorTecnico;
    caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
    await act(async () => { root.render(createElement(AppTecnico, { usuario: USUARIO as any, config: CONFIG_APP_PADRAO, perfilInicial: { nome: "João", email: "j@x.com", avatar: null, empresaNome: "Clima", perfilNome: null, cargo: "Técnico" } })); });
    await esperarAte(() => !!$("[data-camera-cartao]"), "cartão com o atalho");
    const atalho = $("[data-camera-cartao]")!;
    expect(texto(atalho)).toBe("Câmera");
    expect(atalho.className).toContain("touch-target");
    await clicar(atalho);
    await esperarAte(() => !!$("[data-camera-rapida]"), "câmera aberta");
    expect(window.location.search).toBe("?ver=os&a=aA"); // sem o &cam=1: voltar não reabre a câmera
    expect($("[data-vista]")!.getAttribute("data-vista")).toBe("os");
  });
});
