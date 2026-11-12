// @vitest-environment happy-dom
/**
 * Mapa dos técnicos — o lado do APP do técnico, num DOM de verdade, com o banco do aparelho de verdade
 * (IndexedDB via fake-indexeddb), o motor de sincronização real e as vistas trocando pela URL. O GPS,
 * a bateria e a rede são simulados.
 *  - CONSENTIMENTO: com "Rastrear localização dos técnicos" desligado (o padrão) o app NÃO lê a posição,
 *    NÃO envia nada e não mostra indicador — e apaga o que tinha ficado guardado;
 *  - ligado: o técnico vê o tempo todo que a localização é compartilhada (transparência) e o que é lido;
 *  - a leitura acontece nos momentos-chave: abrir o Meu dia, "Cheguei", iniciar e concluir a execução,
 *    e a cada sincronização;
 *  - sem sinal fica na fila do aparelho e sobe depois; bloqueada no navegador, nada é enviado e o app
 *    segue funcionando.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { MotorSync } from "@/lib/tecnico/offline/motor";
import { Rastreio } from "@/lib/tecnico/offline/rastreio";
import { CONFIG_APP_PADRAO } from "@/lib/tecnico/config-app";
import { envioPosicoesSchema } from "@/lib/tecnico/posicao";
import type { RetratoAtividade } from "@/lib/tecnico/offline/tipos";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next-auth/react", () => ({ signOut: vi.fn(), useSession: () => ({ data: null, update: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }), usePathname: () => "/tecnico", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/os/scanner-qr", () => ({ ScannerQR: () => null }));

const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const MIN = 60_000;
const passar = (ms: number) => vi.setSystemTime(Date.now() + ms);
const LIGADO = { ...CONFIG_APP_PADRAO, rastrearLocalizacao: true };

/* ───────── aparelho e servidor simulados ───────── */
let online = true;
let gps: { lat: number; lng: number; precisao: number | null } | null;
let bateria: { nivel: number; carregando: boolean } | null;
let permissao: PermissionState | "indisponivel";
let leituras = 0;
let posicoes: any[] = [];            // o que chegou em /api/tecnico/posicao
let outras: any[] = [];              // o que chegou em /api/tecnico/sync
let servidorRastreia = true;
let chegou = false;

const vazio = { semResposta: [], semFoto: [], semObservacao: [], formulario: null };
const info = { id: "eqA", titulo: "Split Sala 1", descricao: "Split Sala 1", fabricante: "Daikin", tag: null, numeroSerie: null, local: "Sala 1", unidade: "Matriz", ativo: true, tipo: { id: "te1", nome: "Split" } };
const cartao = () => ({
  atividadeId: "aA", osId: "os1", osNumero: "OS-0042", titulo: "Preventiva", tipoOs: null, status: "AGENDADA", prioridade: "NORMAL", dataAgendada: null, dia: "2026-11-12", hora: "13:00", duracaoMin: 60,
  cliente: "Hospital Santa Luzia", telefone: null, unidade: "Matriz", endereco: "Av. Paulista, 1000", rota: null, descricao: "Preventiva mensal", equipamentos: 1, atendidos: 0, adicionais: 0,
  avisos: chegou ? { CHEGOU: { em: new Date(MEIO_DIA).toISOString(), status: "ENVIADO" } } : {},
});
const retrato = (): RetratoAtividade => ({
  cartao: cartao(),
  execucao: {
    atividade: { id: "aA", titulo: "Preventiva", status: "AGENDADA", tipoOs: null }, os: { id: "os1", numero: "OS-0042", status: "ABERTA", clienteId: "c1", unidadeId: "un1" },
    bloqueada: false, adicionais: [], avisos: cartao().avisos,
    equipamentos: [{ vinculoId: "v1", feito: false, observacao: null, equipamento: info, itens: [], respostas: {}, fotos: [], formulario: null, faltas: vazio, completo: false }],
    conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 1, mensagem: null },
  },
  equipamentosUnidade: [{ ...info, tipoEquipamentoId: "te1", qr: null }], checklistsPorTipo: {}, cadastro: null, avisoCliente: { empresa: "Clima Total", whatsapp: null },
  geradoEm: new Date().toISOString(),
}) as unknown as RetratoAtividade;

const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
  if (!online) throw new TypeError("Failed to fetch");
  const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { "content-type": "application/json" } });
  if (url === "/api/tecnico/meu-dia") return json({ tecnico: { id: "t1", nome: "João Silva" }, dia: "2026-11-12", atividades: [cartao()], anteriores: [] });
  if (url.startsWith("/api/tecnico/atividades/")) return json(retrato());
  if (url === "/api/tecnico/posicao") {
    posicoes.push(JSON.parse(String(init!.body)));
    return json(servidorRastreia ? { rastreio: true, gravada: true } : { rastreio: false, gravada: false });
  }
  if (url === "/api/tecnico/sync") {
    const corpo = JSON.parse(String(init!.body));
    outras.push(...corpo.operacoes);
    for (const o of corpo.operacoes) if (o.tipo === "avisoCliente" && o.dados.evento === "CHEGOU") chegou = true;
    return json({ resultados: corpo.operacoes.map((o: any) => ({ id: o.id, ok: true, status: 200, dados: {} })) });
  }
  return json({}, 404);
});

let root: Root; let caixa: HTMLDivElement; let banco: BancoTecnico; let motor: MotorSync; let rastreio: Rastreio | null;
/** O rastreio do app com o aparelho simulado (a função é a mesma entre os renders, como no app) */
const criarRastreio = (m: MotorSync) => (rastreio = new Rastreio(m.banco, {
  fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now(),
  ler: async () => { leituras++; return gps; }, bateria: async () => bateria, permissao: async () => permissao, visivel: () => true,
}));

beforeAll(async () => {
  await Promise.all([import("@/components/tecnico/contexto"), import("@/components/tecnico/meu-dia"), import("@/components/tecnico/execucao"), import("@/components/tecnico/indicador-localizacao"), import("@/components/ui/avisos")]);
}, 120_000);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MEIO_DIA);
  (globalThis as any).indexedDB = new IDBFactory();
  online = true; leituras = 0; posicoes = []; outras = []; servidorRastreia = true; chegou = false; rastreio = null;
  gps = { lat: -23.5505, lng: -46.6333, precisao: 12 }; bateria = { nivel: 82, carregando: false }; permissao = "granted";
  fetchFalso.mockClear();
  vi.stubGlobal("fetch", fetchFalso);
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  banco = await BancoTecnico.abrir("uT");
  motor = new MotorSync(banco, { fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => Date.now() });
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
const texto = (el: Element | null = document.body) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const clicar = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await esperar(); };
const indicador = () => $("[data-indicador-localizacao]");
const vista = () => $("[data-vista]")?.getAttribute("data-vista") ?? null;
/** Os motivos de todas as leituras que chegaram ao servidor, na ordem */
const motivos = () => posicoes.flatMap((e) => e.posicoes.map((l: any) => l.motivo));
const naFilaDoAparelho = async () => ((await banco.ler<any[]>("rastreio:fila")) ?? []).map((l) => l.motivo);
const registrar = async (ops: any[]) => { await act(async () => { await motor.registrar(ops); }); await esperar(); };

async function abrirApp(config: typeof CONFIG_APP_PADRAO = LIGADO) {
  const { ProvedorTecnico, useVista } = await import("@/components/tecnico/contexto");
  const { MeuDia } = await import("@/components/tecnico/meu-dia");
  const { VistaOs } = await import("@/components/tecnico/execucao");
  const { IndicadorLocalizacao } = await import("@/components/tecnico/indicador-localizacao");
  const { Avisos } = await import("@/components/ui/avisos");
  function Vistas() {
    const v = useVista();
    if (!v) return null;
    return v.ver === "os" ? createElement(VistaOs, { key: v.a, atividadeId: v.a, equipamentoId: v.e, camera: v.cam }) : createElement(MeuDia);
  }
  window.history.replaceState(null, "", "/tecnico");
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => {
    root.render(createElement(ProvedorTecnico, { usuario: USUARIO, config, motorPronto: motor, criarRastreio,
      children: [createElement(Avisos, { key: "avisos" }), createElement(IndicadorLocalizacao, { key: "loc" }), createElement(Vistas, { key: "vistas" })] }));
  });
  await esperarAte(() => !!$("[data-cartao]") || !!$("[data-sem-dados]"), "Meu dia");
  await esperar();
}

/* ═════════════════════════ consentimento ═════════════════════════ */
describe("rastreamento DESLIGADO (o padrão): nada é capturado", () => {
  it("o app não lê a posição, não envia nada e não mostra indicador — nem ao abrir, nem no 'Cheguei', nem ao concluir", async () => {
    await abrirApp(CONFIG_APP_PADRAO);
    expect(indicador()).toBeNull();
    await clicar($("[data-cheguei]"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    await registrar([{ tipo: "iniciar", atividadeId: "aA" }, { tipo: "concluir", atividadeId: "aA", dados: {} }]);
    expect(rastreio).toBeNull();   // o rastreio nem é criado
    expect(leituras).toBe(0);      // o GPS nunca foi consultado
    expect(posicoes).toEqual([]);
    expect(fetchFalso.mock.calls.map(([u]) => u)).not.toContain("/api/tecnico/posicao");
    expect(outras.map((o) => o.tipo)).toEqual(["avisoCliente", "iniciar", "concluir"]); // o trabalho segue normal
  });

  it("a empresa desligou e o aparelho ainda tinha leituras guardadas: o app apaga, sem enviar", async () => {
    await banco.gravar("rastreio:fila", [{ lat: -23.5, lng: -46.6, em: new Date(MEIO_DIA - 10 * MIN).toISOString(), motivo: "CHEGUEI" }]);
    await abrirApp(CONFIG_APP_PADRAO);
    await esperar();
    expect(await naFilaDoAparelho()).toEqual([]);
    expect(posicoes).toEqual([]);
  });
});

/* ═════════════════════════ transparência ═════════════════════════ */
describe("rastreamento LIGADO: o técnico vê que a localização é compartilhada", () => {
  it("indicador sempre à vista, com 44 px de toque; ao tocar, explica o que é lido, quando, e mostra a última leitura e o último envio", async () => {
    await abrirApp();
    await esperarAte(() => posicoes.length === 1, "primeira leitura enviada");
    const i = indicador()!;
    expect(texto(i)).toBe("Localização compartilhada com a empresa");
    expect(i.className).toContain("touch-target");
    expect(i.getAttribute("data-leitura")).toBe("ok");
    await clicar(i);
    const d = $("[data-detalhes-localizacao]")!;
    expect(texto(d)).toContain("A empresa vê no mapa a última posição deste aparelho, com o horário e o nível da bateria.");
    expect(texto(d)).toContain("A leitura só acontece com o app aberto. Com o app fechado, nada é lido.");
    expect(texto(d.querySelector("[data-quando-le]"))).toBe("Quando: ao abrir, no “Cheguei”, ao iniciar e concluir a OS e a cada 5 minutos.");
    expect(texto(d.querySelector("[data-ultima-leitura]"))).toBe("12:00");
    expect(texto(d.querySelector("[data-ultimo-envio]"))).toBe("12:00");
    expect(d.querySelector("[data-posicoes-a-enviar]")).toBeNull();
    expect(texto(d)).toContain("Quem liga e desliga é a empresa, em Equipes › App do colaborador.");
  });

  it("o indicador acompanha o técnico dentro da OS também", async () => {
    await abrirApp();
    await clicar($("[data-cheguei]"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(texto(indicador())).toBe("Localização compartilhada com a empresa");
  });

  it("a empresa desliga com o app aberto: o servidor avisa no próximo envio, o indicador some e o app para de ler", async () => {
    servidorRastreia = false;
    await abrirApp();
    await esperarAte(() => posicoes.length === 1, "o servidor respondeu");
    await esperarAte(() => !indicador(), "indicador some");
    leituras = 0;
    await clicar($("[data-cheguei]"));
    await esperarAte(() => vista() === "os", "entrou na OS");
    expect(leituras).toBe(0);
    expect(posicoes).toHaveLength(1);
    expect(await naFilaDoAparelho()).toEqual([]);
  });
});

/* ═════════════════════════ quando lê ═════════════════════════ */
describe("a leitura acontece nos momentos-chave, com o app aberto", () => {
  it("ao abrir o Meu dia: uma leitura (não duas), no formato que o servidor aceita, com a bateria do aparelho", async () => {
    await abrirApp();
    await esperarAte(() => posicoes.length === 1, "leitura ao abrir");
    await esperar();
    expect(posicoes).toHaveLength(1);
    expect(envioPosicoesSchema.safeParse(posicoes[0]).success).toBe(true);
    expect(posicoes[0]).toMatchObject({ origem: "PWA", agora: new Date(MEIO_DIA).toISOString() });
    expect(posicoes[0].posicoes).toEqual([{ lat: -23.5505, lng: -46.6333, precisao: 12, bateria: 82, carregando: false, em: new Date(MEIO_DIA).toISOString(), motivo: "ABRIU_APP" }]);
  });

  it("'Cheguei', iniciar e concluir a execução: uma leitura em cada um, com o horário de cada momento", async () => {
    await abrirApp();
    await esperarAte(() => posicoes.length === 1, "leitura ao abrir");
    passar(10_000); gps = { lat: -23.6, lng: -46.7, precisao: 8 };
    await clicar($("[data-cheguei]"));
    await esperarAte(() => motivos().includes("CHEGUEI"), "leitura do Cheguei");
    passar(10_000);
    await registrar([{ tipo: "iniciar", atividadeId: "aA" }]);
    await esperarAte(() => motivos().includes("INICIO"), "leitura do início");
    passar(10_000);
    await registrar([{ tipo: "concluir", atividadeId: "aA", dados: {} }]);
    await esperarAte(() => motivos().includes("CONCLUSAO"), "leitura da conclusão");
    expect(motivos()).toEqual(["ABRIU_APP", "CHEGUEI", "INICIO", "CONCLUSAO"]);
    const doCheguei = posicoes.flatMap((e) => e.posicoes).find((l: any) => l.motivo === "CHEGUEI");
    expect(doCheguei).toMatchObject({ lat: -23.6, lng: -46.7, em: new Date(MEIO_DIA + 10_000).toISOString() });
  });

  it("'A caminho', foto e respostas NÃO disparam leitura por si; a sincronização dispara, respeitando o intervalo mínimo", async () => {
    chegou = true; // já no local: a OS abre e dá para gravar
    await abrirApp();
    await esperarAte(() => posicoes.length === 1, "leitura ao abrir");
    await registrar([{ tipo: "equipamento", atividadeId: "aA", equipamentoId: "eqA", dados: { observacao: "ok" } }]);
    await esperarAte(() => outras.some((o) => o.tipo === "equipamento"), "gravação sincronizada");
    await esperar();
    expect(motivos()).toEqual(["ABRIU_APP"]); // sincronizou logo depois de abrir: dentro do intervalo, não lê de novo
    passar(2 * MIN);
    await registrar([{ tipo: "equipamento", atividadeId: "aA", equipamentoId: "eqA", dados: { observacao: "ok 2" } }]);
    await esperarAte(() => motivos().includes("SINCRONIZACAO"), "leitura na sincronização");
    expect(motivos()).toEqual(["ABRIU_APP", "SINCRONIZACAO"]);
  });
});

/* ═════════════════════════ sem sinal / bloqueada ═════════════════════════ */
describe("sem sinal e sem permissão", () => {
  it("SEM SINAL: as leituras ficam no aparelho (o técnico vê quantas) e sobem juntas quando o sinal volta", async () => {
    await motor.baixarLista("meuDia", "/api/tecnico/meu-dia");
    await motor.prepararSemSinal(["aA"]);
    online = false;
    await abrirApp();
    await esperarAte(() => rastreio?.atual.aEnviar === 1, "leitura guardada");
    passar(10_000);
    await clicar($("[data-cheguei]"));
    await esperarAte(() => vista() === "os" && rastreio?.atual.aEnviar === 2, "Cheguei guardado");
    expect(posicoes).toEqual([]);
    expect(await naFilaDoAparelho()).toEqual(["ABRIU_APP", "CHEGUEI"]);
    await clicar(indicador());
    expect(texto($("[data-posicoes-a-enviar]"))).toBe("2");
    expect(texto($("[data-ultimo-envio]"))).toBe("—");
    expect(texto($("[data-ultima-leitura]"))).toBe("12:00");

    passar(20 * MIN); online = true;
    await act(async () => { await rastreio!.enviar(); });
    expect(posicoes).toHaveLength(1);
    expect(motivos()).toEqual(["ABRIU_APP", "CHEGUEI"]);
    expect(posicoes[0].agora).toBe(new Date(MEIO_DIA + 10_000 + 20 * MIN).toISOString());
    expect(await naFilaDoAparelho()).toEqual([]);
  });

  it("localização BLOQUEADA no navegador: o indicador diz que nada é enviado, nada sobe, e o app segue funcionando", async () => {
    gps = null; permissao = "denied";
    await abrirApp();
    await esperarAte(() => indicador()?.getAttribute("data-leitura") === "sem-permissao", "indicador de bloqueio");
    expect(texto(indicador())).toBe("Localização bloqueada: nada é enviado");
    await clicar(indicador());
    expect(texto($("[data-localizacao-bloqueada]"))).toBe("A localização está bloqueada neste navegador. Nada é enviado até a permissão ser liberada.");
    expect(texto($("[data-ultima-leitura]"))).toBe("—");
    await clicar([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Fechar" || texto(b) === "Fechar"));
    await clicar($("[data-cheguei]"));
    await esperarAte(() => vista() === "os", "entrou na OS mesmo sem localização");
    expect(posicoes).toEqual([]);
    expect(outras.map((o) => o.tipo)).toEqual(["avisoCliente"]); // a chegada foi gravada normalmente
  });

  it("o aparelho não respondeu (GPS desligado, sem bloqueio): o técnico é avisado e o app tenta de novo sozinho", async () => {
    gps = null; permissao = "granted";
    await abrirApp();
    await esperarAte(() => indicador()?.getAttribute("data-leitura") === "sem-gps", "sem GPS");
    expect(texto(indicador())).toBe("Localização compartilhada com a empresa");
    await clicar(indicador());
    expect(texto($("[data-localizacao-sem-gps]"))).toContain("O aparelho não informou a posição na última tentativa.");
    expect(posicoes).toEqual([]);
  });
});
