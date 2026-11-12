/**
 * NFS-e PR3 (B) — regras puras do aviso automático (webhook) do PlugNotas e da reconciliação:
 * segredo (formato, hash, onde vem na chamada), URL, leitura tolerante do corpo do aviso (só diz
 * QUAIS notas olhar), intervalo da reconciliação conforme a idade e "atrasada" para o sino.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  ATRASO_AVISO_MS, CAMINHO_WEBHOOK, gerarSegredoWebhook, hashSegredo, IDADE_MIN_RECONCILIAR_MS, intervaloReconciliacao, LOTE_RECONCILIAR,
  MAX_REFS_AVISO, notaAtrasada, precisaReconciliar, referenciasDoAviso, segredoDaChamada, STATUS_AVISO_OK, STATUS_AVISO_PROBLEMA,
  STATUS_FINAIS, urlWebhook,
} from "@/lib/nfse/webhook";

const MIN = 60_000;
const SEG = "a".repeat(64);
const cab = (h: Record<string, string> = {}) => new Headers(h);

describe("segredo e URL", () => {
  it("segredo: 64 hex aleatórios; no banco só o SHA-256", () => {
    const a = gerarSegredoWebhook();
    const b = gerarSegredoWebhook();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(hashSegredo(a)).toBe(createHash("sha256").update(a).digest("hex"));
    expect(hashSegredo(a)).not.toBe(a);
    expect(hashSegredo(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("URL: base sem barra final + caminho + ?token=", () => {
    expect(CAMINHO_WEBHOOK).toBe("/api/webhooks/plugnotas");
    expect(urlWebhook("https://app.frivo.com.br/", SEG)).toBe(`https://app.frivo.com.br/api/webhooks/plugnotas?token=${SEG}`);
    expect(urlWebhook("https://app.frivo.com.br//", SEG)).toBe(`https://app.frivo.com.br/api/webhooks/plugnotas?token=${SEG}`);
  });

  it("onde vem o segredo: ?token=, Authorization: Bearer ou x-webhook-token; fora do formato = null", () => {
    expect(segredoDaChamada(SEG, cab())).toBe(SEG);
    expect(segredoDaChamada(` ${SEG.toUpperCase()} `, cab())).toBe(SEG);
    expect(segredoDaChamada(null, cab({ Authorization: `Bearer ${SEG}` }))).toBe(SEG);
    expect(segredoDaChamada(null, cab({ Authorization: `bearer  ${SEG}` }))).toBe(SEG);
    expect(segredoDaChamada(null, cab({ "x-webhook-token": SEG }))).toBe(SEG);
    // o da URL vale primeiro; um inválido não impede o válido do cabeçalho
    expect(segredoDaChamada("b".repeat(64), cab({ Authorization: `Bearer ${SEG}` }))).toBe("b".repeat(64));
    expect(segredoDaChamada("curto", cab({ Authorization: `Bearer ${SEG}` }))).toBe(SEG);
    for (const ruim of ["", "a".repeat(63), "a".repeat(65), "g".repeat(64), `${"a".repeat(63)}'`]) {
      expect(segredoDaChamada(ruim, cab())).toBeNull();
    }
    expect(segredoDaChamada(null, cab({ Authorization: SEG }))).toBeNull(); // sem "Bearer"
    expect(segredoDaChamada(null, cab({ Authorization: `Basic ${SEG}` }))).toBeNull();
    expect(segredoDaChamada(null, cab())).toBeNull();
  });
});

describe("referenciasDoAviso (o corpo só diz QUAIS notas olhar)", () => {
  it("uma nota, uma lista, ou dentro de documents/data/nfse/documento", () => {
    expect(referenciasDoAviso({ id: "pn1", idIntegracao: "nota1", situacao: "CONCLUIDO" })).toEqual([{ id: "pn1", idIntegracao: "nota1" }]);
    expect(referenciasDoAviso([{ id: "pn1" }, { idIntegracao: "nota2" }])).toEqual([{ id: "pn1", idIntegracao: null }, { id: null, idIntegracao: "nota2" }]);
    expect(referenciasDoAviso({ documents: [{ id: "pn3" }] })).toEqual([{ id: "pn3", idIntegracao: null }]);
    expect(referenciasDoAviso({ data: { nfse: { _id: "pn4" } } })).toEqual([{ id: "pn4", idIntegracao: null }]);
    expect(referenciasDoAviso({ documento: { idNota: "pn5" } })).toEqual([{ id: "pn5", idIntegracao: null }]);
    expect(referenciasDoAviso({ documentos: [{ idNfse: "pn6" }], nota: { id: "pn7" } })).toEqual([{ id: "pn6", idIntegracao: null }, { id: "pn7", idIntegracao: null }]);
  });

  it("ordem de preferência do id: id > _id > idNota > idNfse", () => {
    expect(referenciasDoAviso({ id: "a", _id: "b" })).toEqual([{ id: "a", idIntegracao: null }]);
    expect(referenciasDoAviso({ _id: "b", idNota: "c" })).toEqual([{ id: "b", idIntegracao: null }]);
    expect(referenciasDoAviso({ idNota: "c", idNfse: "d" })).toEqual([{ id: "c", idIntegracao: null }]);
  });

  it("ignora o que não é id (número, objeto, caractere estranho, longo demais) e repetidos", () => {
    expect(referenciasDoAviso({ id: 12 })).toEqual([]);
    expect(referenciasDoAviso({ id: "x'; DROP", idIntegracao: "ok-1" })).toEqual([{ id: null, idIntegracao: "ok-1" }]);
    expect(referenciasDoAviso({ id: "a".repeat(101) })).toEqual([]);
    expect(referenciasDoAviso({ id: "a".repeat(100) })).toEqual([{ id: "a".repeat(100), idIntegracao: null }]);
    expect(referenciasDoAviso({ id: " pn1 " })).toEqual([{ id: "pn1", idIntegracao: null }]);
    expect(referenciasDoAviso([{ id: "pn1" }, { id: "pn1" }, { id: "pn1", idIntegracao: "n" }])).toEqual([{ id: "pn1", idIntegracao: null }, { id: "pn1", idIntegracao: "n" }]);
    for (const nada of [null, undefined, "texto", 5, [], {}, { situacao: "CONCLUIDO" }]) expect(referenciasDoAviso(nada)).toEqual([]);
  });

  it("no máximo 20 notas por aviso; não desce mais que 3 níveis", () => {
    expect(MAX_REFS_AVISO).toBe(20);
    expect(referenciasDoAviso(Array.from({ length: 50 }, (_, i) => ({ id: `pn${i}` })))).toHaveLength(20);
    expect(referenciasDoAviso({ data: { data: { data: { id: "fundo" } } } })).toEqual([{ id: "fundo", idIntegracao: null }]);
    expect(referenciasDoAviso({ data: { data: { data: { data: { id: "fundo-demais" } } } } })).toEqual([]);
  });
});

describe("reconciliação", () => {
  const agora = new Date("2026-10-29T12:00:00Z");
  const nota = (status: string, idadeMin: number, consultaMin: number | null) => ({
    status, criadoEm: new Date(agora.getTime() - idadeMin * MIN), ultimaConsultaEm: consultaMin == null ? null : new Date(agora.getTime() - consultaMin * MIN),
  });

  it("intervalo cresce com a idade: 1 min até 30 min, 10 min até 6 h, depois 1 h", () => {
    expect(intervaloReconciliacao(0)).toBe(MIN);
    expect(intervaloReconciliacao(30 * MIN - 1)).toBe(MIN);
    expect(intervaloReconciliacao(30 * MIN)).toBe(10 * MIN);
    expect(intervaloReconciliacao(6 * 60 * MIN - 1)).toBe(10 * MIN);
    expect(intervaloReconciliacao(6 * 60 * MIN)).toBe(60 * MIN);
    expect([IDADE_MIN_RECONCILIAR_MS, ATRASO_AVISO_MS, LOTE_RECONCILIAR]).toEqual([2 * MIN, 30 * MIN, 10]);
  });

  it("só nota esperando resposta, com mais de 2 min, e consultada há tempo bastante", () => {
    expect(precisaReconciliar(nota("PROCESSANDO", 1.9, null), agora)).toBe(false); // a tela cuida
    expect(precisaReconciliar(nota("PROCESSANDO", 2, null), agora)).toBe(true);
    expect(precisaReconciliar(nota("ENVIANDO", 3, null), agora)).toBe(true);
    for (const s of ["CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"]) expect(precisaReconciliar(nota(s, 60, null), agora)).toBe(false);
    expect(precisaReconciliar(nota("PROCESSANDO", 10, 0.5), agora)).toBe(false);
    expect(precisaReconciliar(nota("PROCESSANDO", 10, 1), agora)).toBe(true);
    expect(precisaReconciliar(nota("PROCESSANDO", 60, 9), agora)).toBe(false);
    expect(precisaReconciliar(nota("PROCESSANDO", 60, 10), agora)).toBe(true);
    expect(precisaReconciliar(nota("PROCESSANDO", 7 * 60, 59), agora)).toBe(false);
    expect(precisaReconciliar(nota("PROCESSANDO", 7 * 60, 60), agora)).toBe(true);
  });

  it("atrasada (sino): esperando há 30 min ou mais", () => {
    expect(notaAtrasada(nota("PROCESSANDO", 29.9, null), agora)).toBe(false);
    expect(notaAtrasada(nota("PROCESSANDO", 30, null), agora)).toBe(true);
    expect(notaAtrasada(nota("ENVIANDO", 31, null), agora)).toBe(true);
    expect(notaAtrasada(nota("REJEITADO", 300, null), agora)).toBe(false);
  });

  it("status do sino", () => {
    expect([STATUS_AVISO_OK, STATUS_AVISO_PROBLEMA, STATUS_FINAIS]).toEqual([
      ["CONCLUIDO"], ["REJEITADO", "INTERROMPIDO"], ["CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"],
    ]);
  });
});
