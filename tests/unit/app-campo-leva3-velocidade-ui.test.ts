// @vitest-environment happy-dom
/**
 * App de campo, leva 3 (PR C) — VELOCIDADE E UMA MÃO, na tela, com o banco do aparelho e o motor reais:
 *  - câmera ao vivo dentro do app: 1 toque abre, 1 toque fotografa (sem a tela "Usar foto");
 *  - TUDO OK com fotos PEDIDAS faltando: a câmera já abre nelas e segue sozinha (pedidas → foto depois), com
 *    "Pular" e X; no fim, a tela desce até a primeira medição vazia;
 *  - câmera recusada/sem câmera: a câmera do sistema assume, e o app lembra (não pergunta de novo nesta sessão);
 *  - Galeria só quando a empresa deixa ("Foto somente pela câmera" desligado);
 *  - medições: "Próximo" no teclado grava e vai à seguinte; o último fecha o teclado;
 *  - "Concluir" logo depois de digitar a última medição espera a gravação (não acusa falta à toa);
 *  - "Cheguei" segue para o 1º equipamento a fazer; concluir o último abre a confirmação da conclusão.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { lerVista, urlDaVista } from "@/components/tecnico/contexto";
import type { CartaoTela, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
// O caminho de toda foto do app (redução + marca): aqui cada foto vira um data URL numerado
const imagem = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/imagem-cliente", async () => {
  const { vi: v } = await import("vitest");
  return {
    FOTO_GALERIA: { ladoMax: 1280, qualidade: 0.8 },
    reduzirImagem: v.fn(async (f: Blob) => ({ imagem: { dataUrl: `data:image/jpeg;base64,/9j/FOTO-${String(++imagem.n).padStart(2, "0")}`, largura: 10, altura: 10, bytes: f.size }, qualidade: {} })),
    aplicarMarcaDagua: async (d: string) => d,
    dataUrlParaArquivo: (_d: string, nome: string) => new File([new Uint8Array([1])], nome, { type: "image/jpeg" }),
  };
});

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z");
const HOJE = "2026-11-12";
let online = true;
const ok = (id: string, texto: string, ordem: number, pedirFoto = false) => ({ id, texto, tipoResposta: "OK_ATENCAO_NA", unidade: null, ordem, pedirFoto, pedirObservacao: false, ativo: true, grandeza: null, valorMin: null, valorMax: null });
const med = (id: string, texto: string, unidade: string, ordem: number) => ({ id, texto, tipoResposta: "MEDICAO", unidade, ordem, pedirFoto: false, pedirObservacao: false, ativo: true, grandeza: null, valorMin: null, valorMax: null });
const ITENS = [
  ok("iFiltro", "Limpeza dos filtros de ar", 1, true), ok("iSerp", "Limpeza da serpentina evaporadora", 2, true), ok("iDreno", "Dreno e bandeja", 3),
  med("iSuc", "Pressão de sucção", "psi", 4), med("iDes", "Pressão de descarga", "psi", 5), med("iCor", "Corrente do compressor", "A", 6),
];
const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const cartao = (): CartaoTela => ({
  atividadeId: "aA", osId: "osA", osNumero: "OS-1", titulo: "Preventiva", tipoOs: null, status: "EM_ANDAMENTO", prioridade: "NORMAL", dataAgendada: null, dia: HOJE, hora: "09:00",
  duracaoMin: 60, cliente: "Hospital", telefone: null, unidade: "Matriz", endereco: "Av. Paulista", rota: null, descricao: "Preventiva", equipamentos: 2, atendidos: 0, adicionais: 0, avisos: {},
} as CartaoTela);
const equip = (id: string, titulo: string) => ({ id, titulo, descricao: "Split", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" }, garantiaAte: null });
const blocoEq = (id: string, titulo: string) => ({ vinculoId: `v-${id}`, feito: false, observacao: null, equipamento: equip(id, titulo), itens: ITENS, respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false });
let itens = ITENS;
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "osA", numero: "OS-1", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: {}, materiais: [], comentarios: [],
    equipamentos: [{ ...blocoEq("eqA", "Split Sala 1"), itens }, { ...blocoEq("eqB", "Split Sala 2"), itens }],
    conclusao: { ok: false, semEquipamento: false, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null, dispensa: null },
  },
  equipamentosUnidade: [{ ...equip("eqA", "Split Sala 1"), tipoEquipamentoId: "te1", qr: null }, { ...equip("eqB", "Split Sala 2"), tipoEquipamentoId: "te1", qr: null }],
  checklistsPorTipo: { te1: itens }, cadastro: null, avisoCliente: null, geradoEm: new Date().toISOString(),
} as unknown as RetratoAtividade);
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { "content-type": "application/json" } });
const fetchApp = vi.fn(async (url: string) => {
  if (!online) throw new TypeError("Failed to fetch");
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  return json({}, 404);
});

/* ───────── o "aparelho": câmera ao vivo e canvas ───────── */
let getUserMedia: ReturnType<typeof vi.fn>;
let faixas: { stop: ReturnType<typeof vi.fn> }[] = [];
const erro = (name: string) => Object.assign(new Error(name), { name });
function ligarAparelho() {
  Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: (...a: unknown[]) => getUserMedia(...a) } });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: async () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", { configurable: true, writable: true, value: null });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 1920 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 1080 });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => ({ drawImage: () => undefined }) });
  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", { configurable: true, value(cb: (b: Blob) => void) { cb(new Blob([new Uint8Array([9])], { type: "image/jpeg" })); } });
}

let root: Root | null = null; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync;
let rolou: Element[] = [];
beforeAll(async () => { await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/execucao")]); }, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = false; itens = ITENS; imagem.n = 0; faixas = []; rolou = [];
  sessionStorage.clear();
  vi.stubGlobal("fetch", fetchApp);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  (Element.prototype as any).scrollIntoView = function () { rolou.push(this); };
  ligarAparelho();
  getUserMedia = vi.fn(async () => { const f = [{ stop: vi.fn() }]; faixas.push(...f); return { getTracks: () => f }; });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchApp as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
  await banco.guardarRetrato(retrato(), Date.now());
  vi.spyOn(await import("@/components/ui/avisos"), "toast").mockImplementation(() => {});
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  caixa?.remove(); document.body.innerHTML = ""; root = null;
  banco.fechar(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

const esperar = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); }); };
async function esperarAte(cond: () => boolean, msg = "condição") { for (let i = 0; i < 150; i++) { if (cond()) return; await esperar(1); } throw new Error(`não aconteceu: ${msg}`); }
const $ = <T extends Element = HTMLElement>(sel: string) => document.body.querySelector(sel) as T | null;
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const botao = (rotulo: string) => [...document.body.querySelectorAll("button")].find((b) => texto(b) === rotulo) ?? null;
const valor = async (el: HTMLInputElement | null, v: string) => {
  expect(el).toBeTruthy();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v); el!.dispatchEvent(new Event("input", { bubbles: true })); });
  await esperar(2);
};
const focar = async (el: HTMLElement | null) => { await act(async () => { el!.focus(); }); await esperar(2); };
const enter = async (el: HTMLElement | null) => { await act(async () => { el!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }); await esperar(); };
const campo = (id: string) => $(`[data-item="${id}"] input[data-campo-medicao]`) as HTMLInputElement;
const fila = async () => (await banco.fila()).map((o: any) => o);
const fotosNaFila = async () => (await fila()).filter((o) => o.tipo === "foto").map((o) => ({ itemId: o.dados.itemId ?? null, momento: o.dados.momento ?? null, eq: o.equipamentoId }));
const camera = () => $("[data-camera-sequencia]");
async function cameraPronta() { await esperarAte(() => camera()?.getAttribute("data-fase") === "pronta", "câmera ao vivo aberta"); }
async function disparar() { await clicar($("[data-disparar]")); await esperar(); }

async function abrir(url: string, config = CONFIG_APP_PADRAO) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  // O mesmo roteamento do app (app-tecnico): equipamento, "primeiro" (depois do Cheguei) e "fim" (concluiu o último)
  function Vistas() { const v = useVista(); return v?.ver === "os" ? createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e, primeiro: v.primeiro, fim: v.fim }) : null; }
  window.history.replaceState(null, "", url);
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(ProvedorTecnico, { usuario: { id: "uT", nome: "João", email: "j@x.com", empresaNome: "Clima", podeGravar: true }, config, motorPronto: motor, children: createElement(Vistas) })); });
  await esperarAte(() => !!$("[data-vista]"), "tela carregada");
  await esperar();
}
const abrirEquipamento = (eq = "eqA", config = CONFIG_APP_PADRAO) => abrir(`/tecnico?ver=os&a=aA&e=${eq}`, config);

describe("endereço das vistas: os atalhos novos", () => {
  it("'primeiro' (depois do Cheguei) e 'fim' (concluiu o último) vão e voltam pelo endereço", () => {
    expect(urlDaVista({ ver: "os", a: "aA", primeiro: true })).toBe("/tecnico?ver=os&a=aA&primeiro=1");
    expect(urlDaVista({ ver: "os", a: "aA", fim: true })).toBe("/tecnico?ver=os&a=aA&fim=1");
    expect(lerVista("?ver=os&a=aA&primeiro=1")).toEqual({ ver: "os", a: "aA", e: null, primeiro: true });
    expect(lerVista("?ver=os&a=aA&fim=1")).toEqual({ ver: "os", a: "aA", e: null, fim: true });
    expect(lerVista("?ver=os&a=aA&fim=0&primeiro=0")).toEqual({ ver: "os", a: "aA", e: null });
  });
});

describe("câmera ao vivo no equipamento", () => {
  it("'Foto antes': 1 toque abre a câmera do app, 1 toque fotografa — a foto vai para a fila e a câmera fecha", async () => {
    await abrirEquipamento();
    await clicar(botao("Foto antes"));
    await cameraPronta();
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    expect(texto($("[data-rotulo-passo]"))).toBe("Foto antes do serviço");
    expect($("[data-contagem-passo]")).toBeNull(); // uma foto só
    expect($("[data-pular-passo]")).toBeNull();
    await disparar();
    await esperarAte(() => !camera(), "câmera fechou");
    expect(await fotosNaFila()).toEqual([{ itemId: null, momento: "ANTES", eq: "eqA" }]);
    expect(faixas.every((f) => f.stop.mock.calls.length > 0)).toBe(true); // a câmera desliga ao fechar
    expect($("[data-secao=antes] [data-contagem-fotos]")!.textContent).toBe("1");
  });

  it("TUDO OK com fotos pedidas faltando: a câmera já abre nelas e segue sozinha até a foto depois; no fim, desce até a 1ª medição", async () => {
    await abrirEquipamento();
    await clicar($("[data-tudo-ok]"));
    await cameraPronta();
    expect(texto($("[data-rotulo-passo]"))).toBe("Limpeza dos filtros de ar");
    expect(texto($("[data-contagem-passo]"))).toBe("1 de 3");
    expect(texto(camera()!)).toContain("Split Sala 1");
    await disparar();
    expect(texto($("[data-rotulo-passo]"))).toBe("Limpeza da serpentina evaporadora");
    expect(texto($("[data-contagem-passo]"))).toBe("2 de 3");
    await disparar();
    expect(texto($("[data-rotulo-passo]"))).toBe("Foto depois do serviço");
    expect($("[data-pular-passo]")).toBeNull(); // a última não tem "Pular"
    rolou = [];
    await disparar();
    await esperarAte(() => !camera(), "câmera fechou");
    expect(await fotosNaFila()).toEqual([
      { itemId: "iFiltro", momento: null, eq: "eqA" }, { itemId: "iSerp", momento: null, eq: "eqA" }, { itemId: null, momento: "DEPOIS", eq: "eqA" },
    ]);
    await esperarAte(() => rolou.length > 0, "desceu até a medição");
    expect(rolou.map((el) => el.closest("[data-item]")?.getAttribute("data-item"))).toContain("iSuc");
    expect(getUserMedia).toHaveBeenCalledTimes(1); // uma câmera só para a sequência inteira
  });

  it("'Pular' passa uma foto; o X fecha no meio sem rolar a tela; a próxima sequência só pede o que ainda falta", async () => {
    await abrirEquipamento();
    await clicar($("[data-tudo-ok]"));
    await cameraPronta();
    await clicar($("[data-pular-passo]"));
    expect(texto($("[data-rotulo-passo]"))).toBe("Limpeza da serpentina evaporadora");
    await disparar();
    expect(texto($("[data-contagem-passo]"))).toBe("3 de 3");
    rolou = [];
    await clicar($("[data-fechar-camera]"));
    expect(camera()).toBeNull();
    await esperar();
    expect(rolou).toEqual([]);
    expect(await fotosNaFila()).toEqual([{ itemId: "iSerp", momento: null, eq: "eqA" }]);
    // A foto pedida que faltou: o botão dela abre a sequência só com o que falta (ela e a foto depois)
    await clicar($("[data-item=iFiltro] [data-botao-camera]"));
    await cameraPronta();
    expect(texto($("[data-rotulo-passo]"))).toBe("Limpeza dos filtros de ar");
    expect(texto($("[data-contagem-passo]"))).toBe("1 de 2");
    await disparar();
    expect(texto($("[data-rotulo-passo]"))).toBe("Foto depois do serviço");
  });

  it("TUDO OK sem foto pedida faltando: só marca, a câmera não abre", async () => {
    itens = ITENS.map((i) => ({ ...i, pedirFoto: false }));
    await banco.guardarRetrato(retrato(), Date.now());
    await abrirEquipamento();
    await clicar($("[data-tudo-ok]"));
    await esperar();
    expect(camera()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect((await fila()).map((o) => o.tipo)).toEqual(["tudoOk"]);
  });

  it("câmera bloqueada: a câmera do celular assume na hora (a foto entra no mesmo passo) e o app não insiste nesta sessão", async () => {
    getUserMedia = vi.fn().mockRejectedValue(erro("NotAllowedError"));
    await abrirEquipamento();
    await clicar(botao("Foto antes"));
    await esperarAte(() => camera()?.getAttribute("data-fase") === "sem-camera", "sem câmera");
    expect(texto($("[data-sequencia-sem-camera] [role=alert]"))).toBe("Câmera bloqueada neste navegador.");
    const input = $<HTMLInputElement>("[data-sequencia-sem-camera] input[data-foto-input]")!;
    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array([1])], "f.jpg", { type: "image/jpeg", lastModified: Date.now() })] });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperarAte(() => !camera(), "câmera fechou");
    expect(await fotosNaFila()).toEqual([{ itemId: null, momento: "ANTES", eq: "eqA" }]);
    // Outra tela (ou o mesmo app depois): o botão já é o da câmera do sistema — nada de pedir a câmera de novo
    act(() => root!.unmount()); root = null; caixa.remove();
    await abrirEquipamento();
    expect($("[data-secao=depois] [data-botao-camera]")).toBeNull();
    expect($("[data-secao=depois] input[data-foto-input]")).toBeTruthy();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("navegador sem câmera ao vivo: o botão de sempre (câmera do sistema), sem passo a mais", async () => {
    Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: undefined });
    await abrirEquipamento();
    expect($("[data-botao-camera]")).toBeNull();
    expect($("[data-secao=antes] input[data-foto-input]")).toBeTruthy();
  });

  it("Galeria só quando a empresa deixa ('Foto somente pela câmera' desligado)", async () => {
    await abrirEquipamento();
    await clicar(botao("Foto antes"));
    await cameraPronta();
    expect(texto(camera()!)).toContain("Galeria");
    await clicar($("[data-fechar-camera]"));
    act(() => root!.unmount()); root = null; caixa.remove();
    await abrirEquipamento("eqA", { ...CONFIG_APP_PADRAO, fotoSomenteCamera: true });
    await clicar(botao("Foto antes"));
    await cameraPronta();
    expect(texto(camera()!)).not.toContain("Galeria");
  });

  it("os alvos da câmera são grandes (disparo 80 px; fechar e pular ≥ 44 px)", async () => {
    await abrirEquipamento();
    await clicar($("[data-tudo-ok]"));
    await cameraPronta();
    expect($("[data-disparar]")!.className).toContain("w-20 h-20");
    expect($("[data-fechar-camera]")!.className).toContain("touch-target");
    expect($("[data-pular-passo]")!.className).toContain("touch-target");
  });
});

describe("medições e concluir com uma mão", () => {
  it("'Próximo' no teclado grava e vai à medição seguinte; na última, fecha o teclado", async () => {
    await abrirEquipamento();
    expect(campo("iSuc").getAttribute("enterkeyhint")).toBe("next");
    await focar(campo("iSuc")); await valor(campo("iSuc"), "128");
    await enter(campo("iSuc"));
    expect(document.activeElement).toBe(campo("iDes"));
    await valor(campo("iDes"), "355"); await enter(campo("iDes"));
    expect(document.activeElement).toBe(campo("iCor"));
    expect(campo("iCor").enterKeyHint).toBe("done"); // é a última
    await valor(campo("iCor"), "6,8"); await enter(campo("iCor"));
    expect(document.activeElement).not.toBe(campo("iCor"));
    const resp = (await fila()).filter((o) => o.tipo === "resposta").map((o) => [o.itemId, o.dados]);
    expect(resp).toEqual([["iSuc", { valor: 128 }], ["iDes", { valor: 355 }], ["iCor", { valor: 6.8 }]]);
  });

  it("tocou 'Concluir' direto depois de digitar a última medição: grava o número e conclui (não acusa falta)", async () => {
    itens = ITENS.map((i) => ({ ...i, pedirFoto: false }));
    await banco.guardarRetrato(retrato(), Date.now());
    await abrirEquipamento();
    await clicar($("[data-tudo-ok]"));
    await focar(campo("iSuc")); await valor(campo("iSuc"), "128"); await enter(campo("iSuc"));
    await valor(campo("iDes"), "355"); await enter(campo("iDes"));
    await valor(campo("iCor"), "6,8"); // sem sair do campo
    expect(texto($("[data-concluir-equipamento]"))).toContain("Falta 1");
    await clicar($("[data-concluir-equipamento]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "foi para o próximo");
    expect($("[data-faltas]")).toBeNull();
    const eqA = (await fila()).filter((o) => o.equipamentoId === "eqA").map((o) => o.tipo);
    expect(eqA).toEqual(["tudoOk", "resposta", "resposta", "resposta"]); // completo = atendido (o aparelho marca sozinho)
  });

  it("concluir o último equipamento abre a confirmação da conclusão da atividade (sem o toque em 'Concluir atividade')", async () => {
    itens = ITENS.map((i) => ({ ...i, pedirFoto: false }));
    await banco.guardarRetrato(retrato(), Date.now());
    await abrirEquipamento("eqA");
    for (const eq of ["eqA", "eqB"]) {
      await esperarAte(() => window.location.search.includes(`e=${eq}`), eq);
      await clicar($("[data-tudo-ok]"));
      await focar(campo("iSuc")); await valor(campo("iSuc"), "128"); await enter(campo("iSuc"));
      await valor(campo("iDes"), "355"); await enter(campo("iDes"));
      await valor(campo("iCor"), "6,8"); await enter(campo("iCor"));
      await clicar($("[data-concluir-equipamento]"));
    }
    await esperarAte(() => !!$("[data-confirmar-conclusao]"), "confirmação aberta");
    expect(window.location.search).toBe("?ver=os&a=aA"); // o atalho sai do endereço (voltar não reabre)
    expect(texto(document.body)).toContain("2 equipamentos atendidos");
  });

  it("o último da lista com OUTRO equipamento por fazer: volta à OS sem abrir a confirmação (concluir com equipamento não atendido é decisão do técnico)", async () => {
    itens = ITENS.map((i) => ({ ...i, pedirFoto: false }));
    await banco.guardarRetrato(retrato(), Date.now());
    await abrirEquipamento("eqB");
    await clicar($("[data-tudo-ok]"));
    await focar(campo("iSuc")); await valor(campo("iSuc"), "128"); await enter(campo("iSuc"));
    await valor(campo("iDes"), "355"); await enter(campo("iDes"));
    await valor(campo("iCor"), "6,8"); await enter(campo("iCor"));
    await clicar($("[data-concluir-equipamento]"));
    await esperarAte(() => window.location.search === "?ver=os&a=aA", "voltou à OS");
    await esperarAte(() => !!$("[data-concluir-atividade]"), "OS");
    await esperar();
    expect($("[data-confirmar-conclusao]")).toBeNull();
  });
});

describe("'Cheguei' leva ao equipamento", () => {
  it("a OS segue para o 1º equipamento a fazer; a OS fica no histórico (o 'voltar' volta a ela)", async () => {
    const empurrou: string[] = [];
    const push = window.history.pushState.bind(window.history);
    vi.spyOn(window.history, "pushState").mockImplementation((d, t, u) => { empurrou.push(String(u)); push(d, t, u); });
    await abrir("/tecnico?ver=os&a=aA&primeiro=1");
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqA", "abriu o 1º equipamento");
    expect(empurrou).toEqual(["/tecnico?ver=os&a=aA&e=eqA"]);
    expect($("[data-vista=equipamento]")!.getAttribute("data-equipamento")).toBe("eqA");
  });

  it("o 1º já feito: vai ao seguinte; tudo feito: fica na OS (sem o atalho no endereço)", async () => {
    const r = retrato();
    r.execucao.equipamentos[0] = { ...r.execucao.equipamentos[0], itens: [], feito: true, completo: true };
    await banco.guardarRetrato(r, Date.now());
    await abrir("/tecnico?ver=os&a=aA&primeiro=1");
    await esperarAte(() => window.location.search === "?ver=os&a=aA&e=eqB", "abriu o seguinte");
    act(() => root!.unmount()); root = null; caixa.remove();
    r.execucao.equipamentos[1] = { ...r.execucao.equipamentos[1], itens: [], feito: true, completo: true };
    await banco.guardarRetrato(r, Date.now());
    await abrir("/tecnico?ver=os&a=aA&primeiro=1");
    await esperarAte(() => window.location.search === "?ver=os&a=aA", "ficou na OS");
    expect($("[data-vista=equipamento]")).toBeNull();
  });
});
