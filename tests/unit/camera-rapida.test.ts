/**
 * CÂMERA RÁPIDA — as regras puras e a guarda no aparelho:
 *  - grupos por janela de tempo (30 s) e pelo corte do técnico;
 *  - identidade SÓ pelo QR fotografado; qualquer dúvida fica "a identificar" (nunca chute);
 *  - o grupo vira as gravações que o app já tem (vincular, foto antes/depois, foto do serviço);
 *  - a guarda sobrevive a fechar e reabrir o app (IndexedDB), sem rede.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  INTERVALO_GRUPO_MS, MOTIVO_A_IDENTIFICAR, agrupar, comGrupoSalvo, contarMomentos, identificar, legendaAutomatica, legendaGeral, operacoesDoGrupo, pareceEtiqueta,
  resumoMomentos, semFotos, separarEm, type FotoRapida, type SessaoRapida,
} from "@/lib/tecnico/camera-rapida";
import { BancoTecnico } from "@/lib/tecnico/offline/banco";
import { GuardaRapida } from "@/lib/tecnico/offline/rapida";
import { operacaoSchema } from "@/lib/tecnico/sync";

const T = Date.parse("2026-11-12T15:00:00.000Z");
const S = 1000;
const foto = (id: string, segundos: number, extra: Partial<FotoRapida> = {}): FotoRapida => ({ id, em: T + segundos * S, momento: "ANTES", qr: null, ...extra });
const ids = (gs: { fotos: FotoRapida[] }[]) => gs.map((g) => g.fotos.map((f) => f.id).join(""));
// QR das etiquetas: o link público e o código
const QR_A = "https://app.frivo.com.br/qr/tok-a"; const QR_B = "QR-2026-0200"; const AVULSA = "https://app.frivo.com.br/qr/tok-avulsa";
const resolver = (qr: string) => ({ [QR_A]: "eqA", [QR_B]: "eqB" } as Record<string, string>)[qr] ?? null;

describe("1. grupos por janela de tempo", () => {
  it("o intervalo é de 30 segundos", () => expect(INTERVALO_GRUPO_MS).toBe(30_000));

  it("rajada no mesmo equipamento = um grupo; passou do intervalo sem foto = outro grupo", () => {
    const gs = agrupar([foto("a", 0), foto("b", 3), foto("c", 9), foto("d", 80), foto("e", 84), foto("f", 300)]);
    expect(ids(gs)).toEqual(["abc", "de", "f"]);
    expect(gs[0]).toMatchObject({ id: "a", inicio: T, fim: T + 9 * S });
  });

  it("o intervalo conta da ÚLTIMA foto (rajada longa não quebra) e exatamente 30 s ainda é o mesmo grupo", () => {
    expect(ids(agrupar([foto("a", 0), foto("b", 25), foto("c", 50), foto("d", 75)]))).toEqual(["abcd"]);
    expect(ids(agrupar([foto("a", 0), foto("b", 30)]))).toEqual(["ab"]);
    expect(ids(agrupar([foto("a", 0), foto("b", 30.001)]))).toEqual(["a", "b"]);
  });

  it("'Próximo equipamento': o corte do técnico começa outro grupo mesmo sem pausa (máquinas lado a lado)", () => {
    expect(ids(agrupar([foto("a", 0), foto("b", 2), foto("c", 4, { corte: true }), foto("d", 6)]))).toEqual(["ab", "cd"]);
  });

  it("a ordem é a do disparo, não a de chegada (foto que terminou de processar depois não muda o grupo)", () => {
    expect(ids(agrupar([foto("c", 9), foto("a", 0), foto("d", 80), foto("b", 3)]))).toEqual(["abc", "d"]);
    expect(agrupar([])).toEqual([]);
  });

  it("cada grupo guarda os QR diferentes que apareceram, sem repetir", () => {
    const [g] = agrupar([foto("a", 0), foto("b", 2, { qr: QR_A }), foto("c", 4, { qr: QR_A }), foto("d", 6, { qr: QR_B })]);
    expect(g.qrs).toEqual([QR_A, QR_B]);
  });
});

describe("2. identidade: só pelo QR — na dúvida, a identificar", () => {
  const de = (...qrs: string[]) => identificar({ qrs }, resolver);

  it("a etiqueta de UM equipamento conhecido identifica o grupo inteiro", () => {
    expect(de(QR_A)).toEqual({ estado: "identificado", equipamentoId: "eqA" });
    expect(de(QR_B)).toEqual({ estado: "identificado", equipamentoId: "eqB" });
  });

  it("sem QR nenhum: a identificar — NUNCA herda o equipamento do grupo vizinho", () => {
    expect(de()).toEqual({ estado: "a-identificar", motivo: "sem-qr" });
    const grupos = agrupar([foto("a", 0, { qr: QR_A }), foto("b", 2), foto("c", 120), foto("d", 122)]);
    expect(grupos.map((g) => identificar(g, resolver).estado)).toEqual(["identificado", "a-identificar"]);
  });

  it("DUAS etiquetas no mesmo grupo: a identificar (o técnico separa) — não escolhe uma delas", () => {
    expect(de(QR_A, QR_B)).toEqual({ estado: "a-identificar", motivo: "dois-equipamentos" });
    expect(de(QR_A, AVULSA)).toEqual({ estado: "a-identificar", motivo: "dois-equipamentos" });
    expect(de(AVULSA, "QR-9999")).toEqual({ estado: "a-identificar", motivo: "dois-equipamentos" });
  });

  it("etiqueta do sistema que não é de um equipamento daqui (avulsa): a identificar, levando a etiqueta para etiquetar", () => {
    expect(de(AVULSA)).toEqual({ estado: "a-identificar", motivo: "etiqueta-desconhecida", etiqueta: AVULSA });
  });

  it("QR que NÃO é etiqueta do sistema (placa do fabricante, um link qualquer) é ignorado: não identifica nem atrapalha", () => {
    const fabricante = "https://lg.com/br/suporte?sn=LG24K8891X";
    expect(de(fabricante)).toEqual({ estado: "a-identificar", motivo: "sem-qr" });
    expect(de(fabricante, QR_A, "WIFI:S:Loja;;")).toEqual({ estado: "identificado", equipamentoId: "eqA" });
  });

  it("a mesma etiqueta fotografada pelo link e pelo código é UM equipamento só", () => {
    const r = (qr: string) => (qr === QR_A || qr === "QR-2026-0100" ? "eqA" : null);
    expect(identificar({ qrs: [QR_A, "QR-2026-0100"] }, r)).toEqual({ estado: "identificado", equipamentoId: "eqA" });
  });

  it("o que parece etiqueta do sistema", () => {
    expect([QR_A, QR_B, "QR-10000", "http://x/qr/abc?x=1"].every(pareceEtiqueta)).toBe(true);
    expect(["https://lg.com/x", "WIFI:S:Loja;;", "12345", ""].some(pareceEtiqueta)).toBe(false);
  });

  it("cada motivo tem uma frase curta para a conferência", () => {
    for (const m of Object.values(MOTIVO_A_IDENTIFICAR)) { expect(m.length).toBeLessThan(110); expect(m).not.toMatch(/!/); }
  });
});

describe("3. o grupo vira as gravações que o app já tem", () => {
  const fotos = [{ id: "a1b2c3d4e5f6a7b8", momento: "ANTES" as const, dataUrl: "data:image/jpeg;base64,/9j/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, { id: "b1b2c3d4e5f6a7b8", momento: "DEPOIS" as const, dataUrl: "data:image/jpeg;base64,/9j/BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }];
  const valida = (op: unknown) => operacaoSchema.safeParse({ id: "5b3f9c1e-2a47-4d0b-9c61-0e8a7d2f4b10", em: new Date(T).toISOString(), ...(op as object) }).success;

  it("equipamento que já está na OS: uma 'foto' por imagem, com antes/depois e o id do aparelho (não duplica)", () => {
    const ops = operacoesDoGrupo("at1", fotos, { tipo: "equipamento", equipamentoId: "eqA", por: "qr" }, true);
    expect(ops).toEqual([
      { tipo: "foto", atividadeId: "at1", equipamentoId: "eqA", dados: { dataUrl: fotos[0].dataUrl, momento: "ANTES", clientId: fotos[0].id } },
      { tipo: "foto", atividadeId: "at1", equipamentoId: "eqA", dados: { dataUrl: fotos[1].dataUrl, momento: "DEPOIS", clientId: fotos[1].id } },
    ]);
    expect(ops.every(valida)).toBe(true); // são operações que a fila de sempre aceita
  });

  it("equipamento que ainda NÃO está na OS: vincula ANTES das fotos (a ordem da fila é a ordem no servidor)", () => {
    const ops = operacoesDoGrupo("at1", fotos, { tipo: "equipamento", equipamentoId: "eqN", por: "tecnico" }, false);
    expect(ops.map((o) => o.tipo)).toEqual(["vincular", "foto", "foto"]);
    expect(ops[0]).toEqual({ tipo: "vincular", atividadeId: "at1", equipamentoIds: ["eqN"] });
    expect(ops.every(valida)).toBe(true);
  });

  it("geral da OS: 'fotoOs' sem equipamento, com a legenda automática", () => {
    const ops = operacoesDoGrupo("at1", fotos, { tipo: "geral" }, true);
    expect(ops.map((o) => (o as any).dados.legenda)).toEqual(["Câmera rápida — antes", "Câmera rápida — depois"]);
    expect(ops.every((o) => o.tipo === "fotoOs" && (o as any).dados.equipamentoId === null)).toBe(true);
    expect(ops.every(valida)).toBe(true);
    expect(operacoesDoGrupo("at1", [], { tipo: "geral" }, true)).toEqual([]);
  });

  it("legenda automática = equipamento + antes/depois; contagem por momento", () => {
    expect(legendaAutomatica("Split Sala 12", "ANTES")).toBe("Split Sala 12 — antes");
    expect(legendaAutomatica("  ", "DEPOIS")).toBe("Equipamento — depois");
    expect(legendaGeral("DEPOIS")).toBe("Câmera rápida — depois");
    expect(contarMomentos(fotos)).toEqual({ antes: 1, depois: 1 });
    expect(resumoMomentos({ antes: 3, depois: 0 })).toBe("3 antes");
    expect(resumoMomentos({ antes: 3, depois: 2 })).toBe("3 antes · 2 depois");
  });
});

describe("a sessão: separar, tirar e gravar grupos", () => {
  const sessao = (): SessaoRapida => ({ fotos: [foto("a", 0), foto("b", 2), foto("c", 4), foto("d", 100), foto("e", 102)], salvos: [] });

  it("separar: a foto escolhida passa a começar um grupo", () => {
    expect(ids(agrupar(separarEm(sessao(), "c").fotos))).toEqual(["ab", "c", "de"]);
  });

  it("tirar fotos não junta grupos que estavam separados (nem pelo corte da foto que saiu)", () => {
    const cortada = separarEm(sessao(), "b"); // a | bc | de
    expect(ids(agrupar(semFotos(cortada, ["b"]).fotos))).toEqual(["a", "c", "de"]);
    expect(ids(agrupar(semFotos(sessao(), ["a", "b", "c"]).fotos))).toEqual(["de"]);
  });

  it("grupo gravado: as fotos saem e fica o resumo (para o ✓ da conferência); os outros grupos ficam como estavam", () => {
    const s = sessao();
    const [g1] = agrupar(s.fotos);
    const depois = comGrupoSalvo(s, g1, { tipo: "equipamento", equipamentoId: "eqA", por: "qr" }, T + 500);
    expect(ids(agrupar(depois.fotos))).toEqual(["de"]);
    expect(depois.salvos).toEqual([{ id: "a", destino: { tipo: "equipamento", equipamentoId: "eqA", por: "qr" }, fotoIds: ["a", "b", "c"], antes: 3, depois: 0, em: T + 500 }]);
  });
});

describe("guarda no aparelho: fechar e reabrir sem sinal não perde nada", () => {
  const abrir = (fabrica: IDBFactory) => BancoTecnico.abrir("uT", fabrica);

  it("cada foto fica gravada no disparo; reabrindo o app (outro banco aberto no mesmo aparelho), está tudo lá", async () => {
    const aparelho = new IDBFactory();
    const fetchFalso = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", fetchFalso);
    try {
      let banco = await abrir(aparelho);
      let guarda = new GuardaRapida(banco);
      await guarda.adicionar("at1", foto("a", 0, { qr: QR_A }), "data:image/jpeg;base64,AAAA");
      await guarda.adicionar("at1", foto("b", 2, { momento: "DEPOIS" }), "data:image/jpeg;base64,BBBB");
      await guarda.adicionar("at2", foto("z", 5), "data:image/jpeg;base64,ZZZZ");
      banco.fechar(); // app fechado

      banco = await abrir(aparelho); guarda = new GuardaRapida(banco);
      const s = await guarda.sessao("at1");
      expect(s.fotos.map((f) => [f.id, f.momento, f.qr])).toEqual([["a", "ANTES", QR_A], ["b", "DEPOIS", null]]);
      expect(await guarda.imagem("a")).toBe("data:image/jpeg;base64,AAAA");
      expect(await guarda.imagem("b")).toBe("data:image/jpeg;base64,BBBB");
      expect((await guarda.sessao("at2")).fotos).toHaveLength(1); // uma atividade não mistura com a outra
      expect((await guarda.sessao("at3")).fotos).toEqual([]);
      expect(fetchFalso).not.toHaveBeenCalled(); // nada de rede
      banco.fechar();
    } finally { vi.unstubAllGlobals(); }
  });

  it("disparos em rajada (gravações simultâneas) não se atropelam: todas as fotos ficam no índice, sem repetir", async () => {
    const banco = await abrir(new IDBFactory()); const guarda = new GuardaRapida(banco);
    await Promise.all(Array.from({ length: 12 }, (_, i) => guarda.adicionar("at1", foto(`f${i}`, i), `data:image/jpeg;base64,${i}`)));
    await guarda.adicionar("at1", foto("f3", 3), "data:image/jpeg;base64,de-novo"); // a mesma foto de novo
    const s = await guarda.sessao("at1");
    expect(s.fotos.map((f) => f.id).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `f${i}`).sort());
    banco.fechar();
  });

  it("grupo gravado: as imagens saem da guarda e fica só o resumo; descartar apaga; limpar não deixa nada", async () => {
    const banco = await abrir(new IDBFactory()); const guarda = new GuardaRapida(banco);
    for (const [id, s] of [["a", 0], ["b", 2], ["c", 100], ["d", 200]] as const) await guarda.adicionar("at1", foto(id, s), `data:image/jpeg;base64,${id}`);
    const [g1] = agrupar((await guarda.sessao("at1")).fotos);
    let s = await guarda.gravado("at1", g1, { tipo: "geral" });
    expect(s.fotos.map((f) => f.id)).toEqual(["c", "d"]);
    expect(s.salvos).toHaveLength(1);
    expect(await guarda.imagem("a")).toBeNull();
    expect(await guarda.imagem("c")).toBe("data:image/jpeg;base64,c");
    s = await guarda.descartar("at1", ["c"]);
    expect(s.fotos.map((f) => f.id)).toEqual(["d"]);
    expect(await guarda.imagem("c")).toBeNull();
    s = await guarda.separar("at1", "d");
    expect(s.fotos[0].corte).toBe(true);
    await guarda.limpar("at1");
    expect(await guarda.sessao("at1")).toEqual({ fotos: [], salvos: [] });
    expect(await guarda.imagem("d")).toBeNull();
    banco.fechar();
  });
});
