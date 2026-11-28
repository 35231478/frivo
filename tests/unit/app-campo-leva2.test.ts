/**
 * App de campo, leva 2 (PR A) — REGRAS PURAS:
 *  - garantia visível no app: a frase de cada situação (a mesma regra do escritório: vencendo em até 30 dias, o dia
 *    do fim conta inteiro);
 *  - comentários na OS: validação, idempotência no aparelho, ordem, "novos" no app e o que acende o sino.
 */
import { describe, expect, it } from "vitest";
import { seloGarantia } from "@/lib/tecnico/garantia";
import {
  aplicarComentario, chaveVisto, comentarioSchema, DIAS_SINO_COMENTARIOS, MSG_MENSAGEM_VAZIA, novosComentarios, ordenarComentarios, osComNovidade, TEXTO_MAX, type ComentarioTela,
} from "@/lib/tecnico/comentarios";
import { estadoDaAtividade } from "@/lib/tecnico/offline/estado";
import type { OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/** meio-dia de Brasília (UTC−3) */
const br = (dia: string) => new Date(`${dia}T12:00:00-03:00`);
const HOJE = br("2026-11-12");

describe("garantia visível no app", () => {
  it("vigente: 'Em garantia até'", () => {
    expect(seloGarantia("2028-03-24T11:00:00Z", HOJE)).toEqual({ situacao: "vigente", texto: "Em garantia até 24/03/2028" });
  });
  it("vencendo (até 30 dias, inclusive): 'Garantia vence em'", () => {
    expect(seloGarantia(br("2026-12-12"), HOJE)).toEqual({ situacao: "vencendo", texto: "Garantia vence em 12/12/2026" });
    expect(seloGarantia(br("2026-12-13"), HOJE)!.situacao).toBe("vigente");
    expect(seloGarantia(br("2026-11-12"), HOJE)).toEqual({ situacao: "vencendo", texto: "Garantia vence em 12/11/2026" }); // o dia do fim conta inteiro
  });
  it("vencida (a partir do dia seguinte ao fim): 'Garantia vencida em'", () => {
    expect(seloGarantia(br("2026-11-11"), HOJE)).toEqual({ situacao: "vencida", texto: "Garantia vencida em 11/11/2026" });
  });
  it("sem garantia cadastrada: nada", () => {
    expect(seloGarantia(null, HOJE)).toBeNull();
    expect(seloGarantia(undefined, HOJE)).toBeNull();
    expect(seloGarantia("", HOJE)).toBeNull();
    expect(seloGarantia("lixo", HOJE)).toBeNull(); // data que não se lê: sem selo
  });
});

describe("comentário: o que a fila aceita", () => {
  it("texto obrigatório (espaços não contam), até 2.000; nada além de clientId e texto", () => {
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "Ruído no ventilador" }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "   " }).error?.issues[0].message).toBe(MSG_MENSAGEM_VAZIA); // CHAT-1: texto e/ou foto
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "x".repeat(TEXTO_MAX) }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "x".repeat(TEXTO_MAX + 1) }).success).toBe(false);
    expect(comentarioSchema.safeParse({ clientId: "c1", texto: "ok", origem: "ESCRITORIO" }).success).toBe(false);
    expect(comentarioSchema.safeParse({ texto: "ok" }).success).toBe(false);
    expect(TEXTO_MAX).toBe(2000);
  });
});

const c = (x: Partial<ComentarioTela>): ComentarioTela => ({ id: "i", clientId: null, texto: "t", autor: "Ana", origem: "ESCRITORIO", criadoEm: "2026-11-12T13:00:00.000Z", meu: false, ...x });

describe("comentários no aparelho", () => {
  it("entra na hora, como meu e pendente; o mesmo clientId não entra duas vezes", () => {
    const l = aplicarComentario([], { clientId: "k1", texto: "  Precisa de peça  " }, "2026-11-12T14:00:00.000Z");
    expect(l).toEqual([{ id: null, clientId: "k1", texto: "Precisa de peça", autor: "Você", origem: "APP", criadoEm: "2026-11-12T14:00:00.000Z", meu: true, pendente: true }]);
    expect(aplicarComentario(l, { clientId: "k1", texto: "de novo" }, "x")).toBe(l);
  });
  it("ordem: por data; o que ainda está no aparelho vai por último", () => {
    const l = ordenarComentarios([
      c({ id: "b", criadoEm: "2026-11-12T15:00:00.000Z" }), c({ id: "p", pendente: true, criadoEm: "2026-11-12T10:00:00.000Z" }), c({ id: "a", criadoEm: "2026-11-12T09:00:00.000Z" }),
    ]);
    expect(l.map((x) => x.id)).toEqual(["a", "b", "p"]);
  });
  it("novos = de OUTRAS pessoas depois do visto; nunca abriu = todos os dos outros", () => {
    const l = [c({ criadoEm: "2026-11-12T10:00:00.000Z" }), c({ criadoEm: "2026-11-12T12:00:00.000Z" }), c({ meu: true, criadoEm: "2026-11-12T13:00:00.000Z" })];
    expect(novosComentarios(l, null)).toBe(2);
    expect(novosComentarios(l, "2026-11-12T11:00:00.000Z")).toBe(1);
    expect(novosComentarios(l, "2026-11-12T12:00:00.000Z")).toBe(0); // o visto é o próprio comentário: não é novo
    expect(novosComentarios(undefined, null)).toBe(0);
    expect(chaveVisto("os1")).toBe("comentariosVistos:os1");
  });
  it("na fila: o comentário muda a tela (retrato antigo, sem a lista, começa vazio)", () => {
    const r = {
      cartao: {}, execucao: {
        atividade: { id: "a1", titulo: "x", status: "EM_ANDAMENTO", tipoOs: null }, os: { id: "os1", numero: "OS-1", status: "ABERTA", clienteId: "c", unidadeId: null },
        bloqueada: false, adicionais: [], equipamentos: [], conclusao: { ok: false, semEquipamento: true, pendencias: [], atendidos: 0, naoAtendidos: 0, mensagem: null },
      }, equipamentosUnidade: [], checklistsPorTipo: {}, geradoEm: "",
    } as unknown as RetratoAtividade;
    const op = { seq: 1, id: "o1", tipo: "comentario", atividadeId: "a1", em: "2026-11-12T14:00:00.000Z", criadoEm: "x", estado: "pendente", tentativas: 0, dados: { clientId: "k", texto: "Oi" } } as unknown as OperacaoFila;
    expect(estadoDaAtividade(r, []).comentarios).toEqual([]);
    expect(estadoDaAtividade(r, [op]).comentarios).toMatchObject([{ clientId: "k", texto: "Oi", criadoEm: "2026-11-12T14:00:00.000Z", pendente: true }]);
  });
});

describe("sino do escritório: OS com comentário do campo não lido", () => {
  it("sem leitura ou leitura antes do último comentário: acende; a mais recente primeiro", () => {
    const ultimos = new Map([["os1", new Date("2026-11-12T10:00:00Z")], ["os2", new Date("2026-11-12T12:00:00Z")], ["os3", new Date("2026-11-12T09:00:00Z")]]);
    const lidos = new Map([["os1", new Date("2026-11-12T10:00:00Z")], ["os3", new Date("2026-11-12T08:00:00Z")]]);
    expect(osComNovidade(ultimos, lidos)).toEqual(["os2", "os3"]); // os1 lida no instante do comentário: não acende
    expect(osComNovidade(new Map(), lidos)).toEqual([]);
    expect(DIAS_SINO_COMENTARIOS).toBe(30);
  });
});
