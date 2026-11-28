/**
 * CHAT-1 — RESPONDER uma mensagem: as regras PURAS (aparelho, escritório e servidor).
 *  - o envio: a citada pelo id OU pelo clientId (a "Enviando…"), nunca os dois, nada além;
 *  - a citação: quem falou + uma linha (foto: "Foto" e a miniatura); a recusada não se responde;
 *  - a OS da resposta vem da citada (ou Sem OS); no app, a OS de outro dia entra no seletor pela atividade dele;
 *  - a fila guarda só a referência: a citação vem da própria conversa (inclusive de outra mensagem ainda na fila).
 */
import { describe, expect, it } from "vitest";
import {
  acharCitada, citacaoDe, osDaResposta, podeResponder, preencherCitacoes, refDaCitada, trechoDaCitacao, TRECHO_CITACAO_MAX,
} from "@/lib/chat/regras";
import { aplicarComentario, comentarioSchema, refCitacaoSchema, type ComentarioTela } from "@/lib/tecnico/comentarios";
import { mapaDeAtividades, mensagensDaFila, opcoesDoSeletor, osDoSeletor, atividadeDoEnvio } from "@/lib/tecnico/chat";
import { SEM_OS } from "@/lib/tecnico/despesas";
import type { OperacaoFila } from "@/lib/tecnico/offline/tipos";

const m = (over: Partial<ComentarioTela>): ComentarioTela => ({ id: "x", clientId: "cx", texto: "Oi", autor: "Carlos", origem: "APP", criadoEm: "2026-11-12T12:00:00.000Z", meu: false, ...over });
const OS1 = { id: "os1", numero: "OS-1", cliente: "Bom Preço" };

describe("o envio da resposta", () => {
  it("cita pelo id OU pelo clientId — um dos dois, nunca os dois, nada além", () => {
    expect(refCitacaoSchema.safeParse({ id: "a" }).success).toBe(true);
    expect(refCitacaoSchema.safeParse({ clientId: "c" }).success).toBe(true);
    expect(refCitacaoSchema.safeParse({}).success).toBe(false);
    expect(refCitacaoSchema.safeParse({ id: "a", clientId: "c" }).success).toBe(false);
    expect(refCitacaoSchema.safeParse({ id: "a", osId: "os1" }).success).toBe(false);
    expect(refCitacaoSchema.safeParse({ id: "" }).success).toBe(false);
    expect(refCitacaoSchema.safeParse({ id: "a".repeat(65) }).success).toBe(false);
    expect(comentarioSchema.safeParse({ clientId: "n1", texto: "Ok", respostaA: { id: "a" } }).success).toBe(true);
    expect(comentarioSchema.safeParse({ clientId: "n1", texto: "Ok", respostaA: { id: "a", clientId: "c" } }).success).toBe(false);
    // responder não dispensa o conteúdo: citar não é enviar vazio
    expect(comentarioSchema.safeParse({ clientId: "n1", texto: "", respostaA: { id: "a" } }).success).toBe(false);
  });

  it("a referência: pelo id quando já está no servidor; pela \"Enviando…\" (sem id), pelo clientId", () => {
    expect(refDaCitada({ id: "a", clientId: "c" })).toEqual({ id: "a" });
    expect(refDaCitada({ id: null, clientId: "c" })).toEqual({ clientId: "c" });
    expect(refDaCitada({ id: null, clientId: null })).toBeNull();
  });

  it("a recusada (\"Não enviada\") não se responde; a enviando e a enviada sim", () => {
    expect(podeResponder(m({}))).toBe(true);
    expect(podeResponder(m({ id: null, pendente: true }))).toBe(true);
    expect(podeResponder(m({ id: null, falhou: "Sem conexão" }))).toBe(false);
    expect(podeResponder(m({ id: null, clientId: null }))).toBe(false);
  });
});

describe("a citação", () => {
  it("uma linha: quebras viram espaço; longa termina em reticências, dentro do limite", () => {
    expect(trechoDaCitacao("Linha 1\n\nLinha   2")).toBe("Linha 1 Linha 2");
    const longo = "a".repeat(200);
    const t = trechoDaCitacao(longo);
    expect(t.length).toBe(TRECHO_CITACAO_MAX);
    expect(t.endsWith("…")).toBe(true);
    expect(trechoDaCitacao("x".repeat(TRECHO_CITACAO_MAX))).toBe("x".repeat(TRECHO_CITACAO_MAX)); // no limite, inteira
    expect(trechoDaCitacao("", true)).toBe("Foto");
    expect(trechoDaCitacao("  ", false)).toBe("");
  });

  it("de uma mensagem: quem falou, o trecho, a miniatura da foto e se é minha", () => {
    expect(citacaoDe(m({ id: "a", clientId: "c", autor: "Ana", meu: true, texto: "", foto: { id: "f", miniatura: "data:image/jpeg;base64,AA==" } })))
      .toEqual({ id: "a", clientId: "c", autor: "Ana", meu: true, texto: "Foto", miniatura: "data:image/jpeg;base64,AA==" });
  });

  it("achar a citada na lista: pelo id ou pelo clientId", () => {
    const lista = [m({ id: "a", clientId: "ca" }), m({ id: null, clientId: "cb" })];
    expect(acharCitada(lista, { id: "a", clientId: null })?.clientId).toBe("ca");
    expect(acharCitada(lista, { id: null, clientId: "cb" })?.clientId).toBe("cb");
    // a que já subiu (tem id) também é achada pelo clientId com que foi citada
    expect(acharCitada(lista, { id: null, clientId: "ca" })?.id).toBe("a");
    expect(acharCitada(lista, { id: "zz", clientId: null })).toBeUndefined();
  });

  it("a fila guarda só a referência: a citação vem da conversa; não carregada fica indisponível; a do servidor fica como veio", () => {
    const original = m({ id: null, clientId: "c1", texto: "Cheguei no Hospital.", autor: "João", meu: true, pendente: true });
    const ref = { id: null, clientId: "c1", autor: "", meu: false, texto: "", miniatura: null };
    const resposta = m({ id: null, clientId: "c2", texto: "Portaria liberou.", respostaA: ref });
    const fora = m({ id: null, clientId: "c3", respostaA: { ...ref, clientId: "c9" } });
    const doServidor = m({ id: "s", clientId: "s", respostaA: { id: "q", clientId: null, autor: "Ana", meu: false, texto: "Já", miniatura: null } });
    const [, r, f, s] = preencherCitacoes([original, resposta, fora, doServidor]);
    expect(r.respostaA).toMatchObject({ autor: "João", meu: true, texto: "Cheguei no Hospital." });
    expect(f.respostaA!.indisponivel).toBe(true);
    expect(s.respostaA).toEqual(doServidor.respostaA);
  });

  it("aplicar na OS (retrato do app) e a fila da tela Chat levam a referência", () => {
    const d = { clientId: "c2", texto: "Ok", respostaA: { clientId: "c1" } };
    expect(aplicarComentario([], d, "2026-11-12T12:00:00.000Z")[0].respostaA).toMatchObject({ id: null, clientId: "c1" });
    const op = { id: "o1", tipo: "comentario", atividadeId: SEM_OS, dados: d, criadoEm: "2026-11-12T12:00:00.000Z", estado: "pendente", tentativas: 0 } as unknown as OperacaoFila;
    expect(mensagensDaFila([op], new Map(), "João")[0].respostaA).toMatchObject({ id: null, clientId: "c1", autor: "" });
  });
});

describe("a OS da resposta", () => {
  it("herda a da citada; citada sem OS = Sem OS", () => {
    expect(osDaResposta(m({ os: OS1 }))).toBe("os1");
    expect(osDaResposta(m({ os: null }))).toBeNull();
    expect(osDaResposta(m({}))).toBeNull();
  });

  it("no app: a OS de outro dia entra no seletor pela atividade dele (do dia, guardada ou vinda com a conversa); sem atividade, não", () => {
    const doDia = [{ osId: "osA", numero: "OS-A", cliente: "", emAndamento: true, atividadeId: "aA" }];
    const atividades = mapaDeAtividades(doDia, [{ atividadeId: "aV", osId: "osV", osNumero: "OS-V", cliente: "Escola" }]);
    const opcoes = opcoesDoSeletor(doDia, { id: "osV", numero: "OS-V", cliente: "Escola" }, atividades);
    expect(opcoes.map((o) => [o.osId, o.atividadeId])).toEqual([["osA", "aA"], ["osV", "aV"]]);
    expect(osDoSeletor("osV", "osA", opcoes)).toBe("osV");
    expect(atividadeDoEnvio("osV", opcoes)).toBe("aV");
    // já é do dia: nada a acrescentar
    expect(opcoesDoSeletor(doDia, { id: "osA", numero: "OS-A", cliente: "" }, atividades)).toEqual(doDia);
    // sem atividade dele naquela OS: fica fora, e a escolha cai em Sem OS (a fila sobe pela atividade)
    const sem = opcoesDoSeletor(doDia, { id: "osX", numero: "OS-X", cliente: "" }, atividades);
    expect(sem).toEqual(doDia);
    expect(osDoSeletor("osX", "osA", sem)).toBeNull();
    expect(atividadeDoEnvio(null, sem)).toBe(SEM_OS);
    expect(opcoesDoSeletor(doDia, null, atividades)).toEqual(doDia);
  });
});
