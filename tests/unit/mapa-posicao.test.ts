/**
 * Mapa dos técnicos — regras puras e a CAPTURA no aparelho (com o banco do aparelho de verdade:
 * IndexedDB via fake-indexeddb; GPS, bateria e rede simulados):
 *  - frescor: atual até 15 min, recente até 3 h, depois ANTIGA (cinza); os textos "visto às… · há…";
 *  - bateria que o aparelho não informa é "—", nunca um número inventado;
 *  - a captura: cada leitura entra na fila do aparelho e sobe; sem sinal fica guardada (fechar e reabrir
 *    não perde) e sobe junta quando o sinal volta; momentos-chave sempre leem, os outros respeitam o
 *    intervalo; sem permissão ou sem GPS nada é enviado e nada trava;
 *  - a empresa desligou: o servidor avisa, o app para de ler e apaga o que estava guardado.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { INTERVALO_MINIMO_MS, INTERVALO_PERIODICO_MS, MAX_FILA_POSICOES, Rastreio, motivoDaOperacao, type EstadoRastreio } from "@/lib/tecnico/offline/rastreio";
import {
  LIMITE_ANTIGA_MS, LIMITE_ATUAL_MS, MAX_LEITURAS_POR_ENVIO, envioPosicoesSchema, frescor, haQuanto, iniciais, leituraSchema, linkNoMapa, maisNova,
  ordenarParaLista, textoBateria, textoCoordenadas, textoPrecisao, textoVisto, vistoAs, type TecnicoNoMapa,
} from "@/lib/tecnico/posicao";
import { nivelBateria } from "@/lib/tecnico/geo";
import { CONFIG_APP_PADRAO, configAppParaPayload, normalizarConfigApp } from "@/lib/tecnico/config-app";

const MIN = 60_000;
const H = 60 * MIN;
const MEIO_DIA = Date.parse("2026-11-12T15:00:00.000Z"); // 12:00 em Brasília
const ha = (ms: number) => new Date(MEIO_DIA - ms).toISOString();

/* ═════════════════════════ regras puras ═════════════════════════ */
describe("frescor: o mapa mostra a última posição CONHECIDA, não a atual", () => {
  it("atual até 15 min; recente até 3 h; depois disso ANTIGA (aparece cinza)", () => {
    expect([LIMITE_ATUAL_MS, LIMITE_ANTIGA_MS]).toEqual([15 * MIN, 3 * H]);
    expect([frescor(ha(0), MEIO_DIA), frescor(ha(15 * MIN), MEIO_DIA)]).toEqual(["atual", "atual"]);
    expect([frescor(ha(15 * MIN + 1000), MEIO_DIA), frescor(ha(3 * H), MEIO_DIA)]).toEqual(["recente", "recente"]);
    expect([frescor(ha(3 * H + 1000), MEIO_DIA), frescor(ha(26 * H), MEIO_DIA)]).toEqual(["antiga", "antiga"]);
    expect(frescor("data ruim", MEIO_DIA)).toBe("antiga"); // sem horário confiável nunca parece tempo real
    expect(frescor(new Date(MEIO_DIA + 5 * MIN), MEIO_DIA)).toBe("atual"); // relógios um pouco diferentes
  });

  it("'há quanto tempo': agora, minutos, horas (com os minutos até 3 h) e dias", () => {
    expect([haQuanto(ha(20_000), MEIO_DIA), haQuanto(ha(5 * MIN), MEIO_DIA), haQuanto(ha(59 * MIN), MEIO_DIA)]).toEqual(["agora", "há 5 min", "há 59 min"]);
    expect([haQuanto(ha(H), MEIO_DIA), haQuanto(ha(80 * MIN), MEIO_DIA), haQuanto(ha(3 * H + 20 * MIN), MEIO_DIA)]).toEqual(["há 1 h", "há 1 h 20 min", "há 3 h"]);
    expect([haQuanto(ha(23 * H), MEIO_DIA), haQuanto(ha(26 * H), MEIO_DIA), haQuanto(ha(72 * H), MEIO_DIA)]).toEqual(["há 23 h", "há 1 dia", "há 3 dias"]);
    expect(haQuanto(new Date(MEIO_DIA + MIN), MEIO_DIA)).toBe("agora"); // nunca "há -1 min"
  });

  it("'visto às HH:MM' (Brasília); se não foi hoje, leva o dia — e o texto completo junta os dois", () => {
    expect(vistoAs(ha(5 * MIN), MEIO_DIA)).toBe("visto às 11:55");
    expect(vistoAs(ha(18 * H + 18 * MIN), MEIO_DIA)).toBe("visto em 11/11 às 17:42");
    expect(textoVisto(ha(5 * MIN), MEIO_DIA)).toBe("visto às 11:55 · há 5 min");
    expect(textoVisto(ha(18 * H + 18 * MIN), MEIO_DIA)).toBe("visto em 11/11 às 17:42 · há 18 h");
    // 00:30 de Brasília ainda é "hoje" para quem olha às 12:00 (o dia é o de Brasília, não o UTC)
    expect(vistoAs("2026-11-12T03:30:00.000Z", MEIO_DIA)).toBe("visto às 00:30");
    expect(vistoAs("2026-11-12T02:30:00.000Z", MEIO_DIA)).toBe("visto em 11/11 às 23:30");
  });
});

describe("o que a tela mostra", () => {
  it("bateria: o número quando o aparelho informa; '—' quando não (iPhone na web) — nunca inventada", () => {
    expect([textoBateria(82), textoBateria(82, true), textoBateria(0), textoBateria(100, false)]).toEqual(["82%", "82% · carregando", "0%", "100%"]);
    expect([textoBateria(null), textoBateria(undefined), textoBateria(null, true), textoBateria(Number.NaN)]).toEqual(["—", "—", "—", "—"]);
  });

  it("coordenadas com 6 casas e vírgula; precisão em metros ou km; link do ponto; iniciais do marcador", () => {
    expect(textoCoordenadas(-23.55052, -46.633308)).toBe("-23,550520, -46,633308");
    expect([textoPrecisao(12.4), textoPrecisao(999), textoPrecisao(1240), textoPrecisao(null), textoPrecisao(undefined)]).toEqual(["±12 m", "±999 m", "±1,2 km", "", ""]);
    expect(linkNoMapa(-23.5, -46.6)).toBe("https://www.google.com/maps/search/?api=1&query=-23.5,-46.6");
    expect([iniciais("Carlos Oliveira"), iniciais("Ana"), iniciais("  maria  da  silva "), iniciais("")]).toEqual(["CO", "AN", "MS", "?"]);
  });

  it("lista: os vistos há menos tempo primeiro; sem posição no fim, por nome", () => {
    const t = (id: string, nome: string, min: number | null): TecnicoNoMapa => ({
      id, nome, os: null, posicao: min === null ? null : { lat: 0, lng: 0, precisaoM: null, bateria: null, carregando: null, registradoEm: ha(min * MIN), motivo: "ABRIU_APP", origem: "PWA" },
    });
    expect(ordenarParaLista([t("a", "Zé", null), t("b", "Bia", 200), t("c", "Caio", 2), t("d", "Ana", null), t("e", "Edu", 30)]).map((x) => x.id)).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("a leitura mais nova de um lote, em qualquer ordem; horário inválido perde", () => {
    const l = (em: string) => ({ em });
    expect(maisNova([l(ha(10 * MIN)), l(ha(MIN)), l(ha(5 * MIN))])!.em).toBe(ha(MIN));
    expect(maisNova([l("ruim"), l(ha(5 * MIN))])!.em).toBe(ha(5 * MIN));
    expect(maisNova([])).toBeNull();
  });
});

describe("o envio (formato único: app web hoje, nativo depois)", () => {
  const boa = { lat: -23.55, lng: -46.63, em: ha(0), motivo: "ABRIU_APP" as const };
  it("leitura mínima vale (precisão e bateria são opcionais); campo estranho, coordenada impossível e motivo desconhecido não", () => {
    expect(leituraSchema.safeParse(boa).success).toBe(true);
    expect(leituraSchema.safeParse({ ...boa, precisao: null, bateria: null, carregando: null }).success).toBe(true);
    expect(leituraSchema.safeParse({ ...boa, precisao: 8.2, bateria: 55, carregando: true }).success).toBe(true);
    for (const ruim of [{ ...boa, lat: -91 }, { ...boa, lng: 181 }, { ...boa, bateria: 55.5 }, { ...boa, bateria: -1 }, { ...boa, motivo: "OUTRO" }, { ...boa, tecnicoId: "t9" }, { lat: 1, lng: 1, motivo: "ABRIU_APP" }]) {
      expect(leituraSchema.safeParse(ruim).success, JSON.stringify(ruim)).toBe(false);
    }
  });

  it("um envio leva de 1 a 200 leituras, o relógio do aparelho e a origem (PWA ou NATIVO)", () => {
    expect(envioPosicoesSchema.safeParse({ posicoes: [boa] }).success).toBe(true);
    expect(envioPosicoesSchema.safeParse({ posicoes: [{ ...boa, motivo: "SEGUNDO_PLANO" }], agora: ha(0), origem: "NATIVO" }).success).toBe(true);
    expect(envioPosicoesSchema.safeParse({ posicoes: [] }).success).toBe(false);
    expect(envioPosicoesSchema.safeParse({ posicoes: Array(MAX_LEITURAS_POR_ENVIO + 1).fill(boa) }).success).toBe(false);
    expect(envioPosicoesSchema.safeParse({ posicoes: [boa], origem: "OUTRA" }).success).toBe(false);
  });

  it("os momentos-chave da execução: 'Cheguei', iniciar e concluir; o resto não dispara leitura", () => {
    expect(motivoDaOperacao({ tipo: "avisoCliente", dados: { evento: "CHEGOU" } })).toBe("CHEGUEI");
    expect(motivoDaOperacao({ tipo: "iniciar" })).toBe("INICIO");
    expect(motivoDaOperacao({ tipo: "concluir", dados: {} })).toBe("CONCLUSAO");
    for (const op of [{ tipo: "avisoCliente", dados: { evento: "A_CAMINHO" } }, { tipo: "foto" }, { tipo: "resposta" }, { tipo: "tudoOk" }]) expect(motivoDaOperacao(op)).toBeNull();
  });

  it("a permissão do rastreamento nasce DESLIGADA e viaja com as outras do app", () => {
    expect(CONFIG_APP_PADRAO.rastrearLocalizacao).toBe(false);
    expect(normalizarConfigApp(null).rastrearLocalizacao).toBe(false);
    expect(normalizarConfigApp({}).rastrearLocalizacao).toBe(false);
    expect(normalizarConfigApp({ appRastrearLocalizacao: true }).rastrearLocalizacao).toBe(true);
    // "Exigir localização" (trava do app) é outra chave: não liga o rastreamento
    expect(normalizarConfigApp({ appExigirLocalizacao: true }).rastrearLocalizacao).toBe(false);
    expect(configAppParaPayload({ ...CONFIG_APP_PADRAO, rastrearLocalizacao: true }).appRastrearLocalizacao).toBe(true);
  });
});

describe("bateria do aparelho", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("Android (o navegador informa): nível de 0 a 100 e se está carregando", async () => {
    vi.stubGlobal("navigator", { getBattery: async () => ({ level: 0.823, charging: true }) });
    expect(await nivelBateria()).toEqual({ nivel: 82, carregando: true });
  });
  it("iPhone (a web não informa) ou erro do navegador: null — quem mostra escreve '—'", async () => {
    vi.stubGlobal("navigator", {});
    expect(await nivelBateria()).toBeNull();
    vi.stubGlobal("navigator", { getBattery: async () => { throw new Error("bloqueado"); } });
    expect(await nivelBateria()).toBeNull();
    vi.stubGlobal("navigator", { getBattery: async () => ({ level: Number.NaN, charging: false }) });
    expect(await nivelBateria()).toBeNull();
  });
});

/* ═════════════════════════ a captura no aparelho ═════════════════════════ */
describe("captura no aparelho", () => {
  let banco: BancoTecnico;
  let relogio: number;
  let online: boolean;
  let gps: { lat: number; lng: number; precisao: number | null } | null;
  let bateria: { nivel: number; carregando: boolean } | null;
  let permissao: PermissionState | "indisponivel";
  let resposta: () => Response;
  let envios: any[];
  let leituras: number;
  const fetchFalso = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("Failed to fetch");
    envios.push({ url: _url, ...JSON.parse(String(init!.body)) });
    return resposta();
  });
  const ok = (corpo: unknown = { rastreio: true, gravada: true }, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
  const novo = () => new Rastreio(banco, {
    fetch: fetchFalso as unknown as typeof fetch, online: () => online, agora: () => relogio,
    ler: async () => { leituras++; return gps; }, bateria: async () => bateria, permissao: async () => permissao, visivel: () => true,
  });
  const fila = async () => (await banco.ler<any[]>("rastreio:fila")) ?? [];
  /** Lê e espera o envio que a leitura dispara */
  async function capturar(r: Rastreio, motivo: Parameters<Rastreio["capturar"]>[0]) { const leu = await r.capturar(motivo); await r.enviar(); return leu; }

  beforeEach(async () => {
    (globalThis as any).indexedDB = new IDBFactory();
    banco = await BancoTecnico.abrir("uT");
    relogio = MEIO_DIA; online = true; envios = []; leituras = 0; permissao = "granted";
    gps = { lat: -23.5505, lng: -46.6333, precisao: 12 }; bateria = { nivel: 82, carregando: false };
    resposta = () => ok();
    fetchFalso.mockClear();
  });
  afterEach(() => { banco.fechar(); });

  it("com sinal: a leitura sobe na hora — coordenadas, precisão, bateria, o horário do aparelho e o que a disparou", async () => {
    const r = novo();
    expect(await capturar(r, "CHEGUEI")).toBe(true);
    expect(envios).toEqual([{
      url: "/api/tecnico/posicao", origem: "PWA", agora: new Date(MEIO_DIA).toISOString(),
      posicoes: [{ lat: -23.5505, lng: -46.6333, precisao: 12, bateria: 82, carregando: false, em: new Date(MEIO_DIA).toISOString(), motivo: "CHEGUEI" }],
    }]);
    expect(envioPosicoesSchema.safeParse({ posicoes: envios[0].posicoes, agora: envios[0].agora, origem: envios[0].origem }).success).toBe(true); // o servidor aceita exatamente isto
    expect(await fila()).toEqual([]);
    expect(r.atual).toEqual<EstadoRastreio>({ leitura: "ok", ultimaLeituraEm: MEIO_DIA, ultimoEnvioEm: MEIO_DIA, aEnviar: 0, desligado: false });
  });

  it("iPhone (sem bateria na web): a leitura vai com a bateria VAZIA", async () => {
    bateria = null;
    await capturar(novo(), "ABRIU_APP");
    expect(envios[0].posicoes[0]).toMatchObject({ bateria: null, carregando: null, lat: -23.5505 });
  });

  it("SEM SINAL: as leituras ficam na fila do aparelho, nada é enviado; o sinal volta e sobem juntas, com o horário de cada uma", async () => {
    online = false;
    const r = novo();
    await capturar(r, "CHEGUEI");
    relogio += 4 * MIN; gps = { lat: -23.6, lng: -46.7, precisao: 30 };
    await capturar(r, "INICIO");
    expect(envios).toEqual([]);
    expect(fetchFalso).not.toHaveBeenCalled(); // sem sinal nem tenta a rede (não gasta bateria à toa)
    expect((await fila()).map((l) => [l.motivo, l.lat, l.em])).toEqual([["CHEGUEI", -23.5505, new Date(MEIO_DIA).toISOString()], ["INICIO", -23.6, new Date(MEIO_DIA + 4 * MIN).toISOString()]]);
    expect(r.atual).toMatchObject({ leitura: "ok", aEnviar: 2, ultimoEnvioEm: null });

    relogio += 20 * MIN; online = true;
    await r.enviar();
    expect(envios).toHaveLength(1);
    expect(envios[0].posicoes.map((l: any) => l.motivo)).toEqual(["CHEGUEI", "INICIO"]);
    expect(envios[0].agora).toBe(new Date(MEIO_DIA + 24 * MIN).toISOString()); // o servidor mede o atraso de cada leitura
    expect(await fila()).toEqual([]);
    expect(r.atual).toMatchObject({ aEnviar: 0, ultimoEnvioEm: MEIO_DIA + 24 * MIN });
  });

  it("fechar e reabrir o app sem sinal não perde a fila: o app reaberto envia o que estava guardado", async () => {
    online = false;
    await capturar(novo(), "CONCLUSAO");
    banco.fechar();
    banco = await BancoTecnico.abrir("uT"); // o app reaberto
    expect(await fila()).toHaveLength(1);
    online = true;
    const reaberto = novo();
    await reaberto.enviar();
    expect(envios[0].posicoes).toEqual([expect.objectContaining({ motivo: "CONCLUSAO", lat: -23.5505 })]);
    expect(await fila()).toEqual([]);
  });

  it("a fila do aparelho é curta: guarda só as últimas leituras (o servidor fica com a mais nova)", async () => {
    online = false;
    const r = novo();
    for (let i = 0; i < MAX_FILA_POSICOES + 5; i++) { relogio += MIN; gps = { lat: -23 - i / 100, lng: -46, precisao: 10 }; await capturar(r, "CHEGUEI"); }
    const guardadas = await fila();
    expect(guardadas).toHaveLength(MAX_FILA_POSICOES);
    expect(guardadas.at(-1).lat).toBeCloseTo(-23 - (MAX_FILA_POSICOES + 4) / 100); // a mais nova está lá
    expect(guardadas[0].lat).toBeCloseTo(-23 - 5 / 100);                            // as 5 mais antigas saíram
  });

  it("momentos-chave SEMPRE leem; abrir o app, sincronizar e a leitura periódica respeitam o intervalo mínimo", async () => {
    const r = novo();
    await capturar(r, "ABRIU_APP");
    expect(await capturar(r, "ABRIU_APP")).toBe(false);     // de novo, na mesma hora: não lê
    expect(await capturar(r, "SINCRONIZACAO")).toBe(false);
    expect(await capturar(r, "PERIODICO")).toBe(false);
    expect(leituras).toBe(1);
    expect(await capturar(r, "CHEGUEI")).toBe(true);         // momento-chave: lê mesmo assim
    expect(await capturar(r, "CONCLUSAO")).toBe(true);
    expect(leituras).toBe(3);
    relogio += INTERVALO_MINIMO_MS;
    expect(await capturar(r, "PERIODICO")).toBe(true);
    expect(envios.map((e) => e.posicoes[0].motivo)).toEqual(["ABRIU_APP", "CHEGUEI", "CONCLUSAO", "PERIODICO"]);
    expect(INTERVALO_PERIODICO_MS).toBe(5 * MIN);
  });

  it("localização BLOQUEADA no navegador: nada entra na fila, nada é enviado, e o estado diz 'sem permissão' (o app não trava)", async () => {
    gps = null; permissao = "denied";
    const r = novo();
    expect(await capturar(r, "CHEGUEI")).toBe(false);
    expect(envios).toEqual([]);
    expect(await fila()).toEqual([]);
    expect(r.atual).toMatchObject({ leitura: "sem-permissao", ultimaLeituraEm: null, aEnviar: 0 });
    // liberou: volta a ler
    gps = { lat: -23.5, lng: -46.6, precisao: 20 }; permissao = "granted";
    expect(await capturar(r, "INICIO")).toBe(true);
    expect(r.atual.leitura).toBe("ok");
  });

  it("o GPS não respondeu (sem bloqueio): 'sem GPS', nada enviado; o que já estava na fila ainda sobe", async () => {
    online = false;
    const r = novo();
    await capturar(r, "CHEGUEI");
    online = true; gps = null; permissao = "granted";
    expect(await capturar(r, "INICIO")).toBe(false);
    expect(r.atual.leitura).toBe("sem-gps");
    expect(envios).toHaveLength(1);
    expect(envios[0].posicoes.map((l: any) => l.motivo)).toEqual(["CHEGUEI"]);
  });

  it("a empresa DESLIGOU o rastreamento: o servidor avisa, o app apaga a fila e para de ler", async () => {
    resposta = () => ok({ rastreio: false, gravada: false });
    const r = novo();
    await capturar(r, "CHEGUEI");
    expect(await fila()).toEqual([]);
    expect(r.atual).toMatchObject({ desligado: true, aEnviar: 0 });
    leituras = 0;
    expect(await capturar(r, "CONCLUSAO")).toBe(false);
    expect(leituras).toBe(0); // nem pede a posição ao aparelho
    expect(envios).toHaveLength(1);
  });

  it("o servidor fora do ar (500) ou sessão expirada (401): a fila fica para depois; recusa definitiva (400) não deixa o app preso", async () => {
    const r = novo();
    resposta = () => ok({ erro: "x" }, 500);
    await capturar(r, "CHEGUEI");
    expect(await fila()).toHaveLength(1);
    resposta = () => ok({ erro: "x" }, 401);
    await r.enviar();
    expect(await fila()).toHaveLength(1);
    expect(r.atual.ultimoEnvioEm).toBeNull();
    resposta = () => ok({ erro: "Posição inválida" }, 400);
    await r.enviar();
    expect(await fila()).toEqual([]);
    expect(r.atual.ultimoEnvioEm).toBeNull(); // não conta como enviado
  });

  it("'esquecer' apaga o que ficou guardado de quando o rastreamento estava ligado", async () => {
    online = false;
    await capturar(novo(), "CHEGUEI");
    expect(await fila()).toHaveLength(1);
    await Rastreio.esquecer(banco);
    expect(await fila()).toEqual([]);
  });

  it("o aparelho não consegue guardar (sem espaço): a captura não lança — o rastreio nunca atrapalha o trabalho", async () => {
    const r = novo();
    vi.spyOn(banco, "gravar").mockRejectedValue(new Error("QuotaExceededError"));
    await expect(r.capturar("CHEGUEI")).resolves.toBe(false);
    vi.restoreAllMocks();
  });
});
